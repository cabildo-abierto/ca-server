import Redis from "ioredis"
import {getCollectionFromUri, getDidFromUri, isCAProfile, isFollow, splitUri} from "#/utils/uri";
import {unique} from "#/utils/arrays";
import {formatIsoDate} from "#/utils/dates";
import {FollowingFeedSkeletonElement} from "#/services/feed/inicio/following";
import {Profile} from "#/lib/types";
import {CAHandler} from "#/utils/handler";
import {Logger} from "#/utils/logger";


class CacheKey {
    cache: RedisCache

    constructor(cache: RedisCache) {
        this.cache = cache
    }

    async onUpdateRecord(uri: string) {

    }

    async onUpdateRecords(uris: string[]) {
        for(const uri of uris) {
            await this.onUpdateRecord(uri)
        }
    }

    async onEvent(e: RedisEvent, params: string[]) {

    }


    buildKey(params: string[]) {
        return params.join(":")
    }
}


class ProfileCacheKey extends CacheKey {
    // Se actualiza si:
    // Cambia el record del perfil de Bluesky o Cabildo Abierto
    // Se verifica al usuario
    // Cambia el nivel de edicion del usuario (todavía no)
    // Cuando

    async onUpdateRecord(uri: string) {
        const {did, collection, rkey} = splitUri(uri)
        if(collection == "app.bsky.actor.profile" && rkey == "self"){
            await this.del(did)
        } else if(isCAProfile(collection)){
            await this.del(did)
        }
    }

    private del(did: string) {
        return this.cache.redis.del(this.key(did))
    }

    key(did: string) {
        return `profile:${did}`
    }

    formatCached(p: string | null): Profile | null {
        if(p == null) return null
        const profile: Profile = JSON.parse(p)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const {viewer, ...bskyNoViewer} = profile.bsky

        // sacamos al viewer porque depende del agent
        return {
            ca: profile.ca,
            bsky: bskyNoViewer
        }
    }

    async get(did: string): Promise<Profile | null> {
        const cached = await this.cache.redis.get(this.key(did))
        if(!cached) return null
        return this.formatCached(cached)
    }

    async getMany(dids: string[]) {
        const cached = await this.cache.redis.mget(dids.map(this.key))
        const profiles: (Profile | null)[] = cached.map(this.formatCached)
        return profiles
    }

    async set(did: string, profile: Profile) {
        await this.cache.redis.set(
            this.key(did),
            JSON.stringify(profile)
        )
    }

    async onEvent(e: RedisEvent, params: string[]) {
        if(e == "verification-update" && params.length == 1) {
            const [did] = params
            await this.del(did)
        }
    }
}


export class FollowingFeedSkeletonKey extends CacheKey {
    params: string[]

    constructor(cache: RedisCache, params: string[]) {
        super(cache)
        this.params = params
    }

    key(did: string) {
        return this.buildKey(["following-feed-skeleton", did, ...this.params])
    }

    async get(did: string, score: number | null, limit: number): Promise<string[]> {
        const max = score != null ? score-1 : "+inf"
        return this.cache.redis
            .zrevrangebyscore(
                this.key(did),
                max,
                '-inf',
                'WITHSCORES',
                'LIMIT',
                0,
                limit
            )
    }

    async add(did: string, elements: ({score: number} & FollowingFeedSkeletonElement)[]) {
        await this.cache.redis.zadd(this.key(did),
            ...elements.flatMap(({score, ...r}) => {
                return [score, JSON.stringify(r)]
            })
        )
    }
}


class CAFollowsCacheKey extends CacheKey {
    async onUpdateRecords(uris: string[]) {
        uris = uris.filter(u => isFollow(getCollectionFromUri(u)))
        if(uris.length == 0) return
        const dids = unique(uris.map(getDidFromUri))
        for(let i = 0; i < dids.length; i++){
            await this.cache.redis.del(`ca-follows:${dids[i]}`)
        }
    }

    key(did: string){
        return `ca-follows:${did}`
    }

    async get(did: string): Promise<string[] | null> {
        const cached = await this.cache.redis.get(this.key(did));
        if (cached) {
            return JSON.parse(cached);
        }
        return null
    }

    async set(did: string, follows: string[]) {
        await this.cache.redis.set(
            this.key(did),
            JSON.stringify(follows),
            "EX",
            60 * 5
        ) // 5 min TTL
    }
}


class FollowSuggestionsDirtyCacheKey extends CacheKey {
    async onUpdateRecords(uris: string[]) {
        uris = uris.filter(u => isFollow(getCollectionFromUri(u)))
        if(uris.length == 0) return
        const dids = unique(uris.map(getDidFromUri))
        for(let i = 0; i < dids.length; i++){
            await this.setFollowSuggestionsDirty(dids[i])
        }
    }

    async setFollowSuggestionsDirty(did: string) {
        await this.cache.redis.sadd("follow-suggestions-dirty", did)
    }

    async setFollowSuggestionsReady(did: string) {
        await this.cache.redis.srem("follow-suggestions-dirty", did)
    }

    async onEvent(e: RedisEvent, params: string[]) {
        if(params.length == 1){
            const did = params[0]
            if(e == "follow-suggestions-ready"){
                await this.setFollowSuggestionsReady(did)
            } else if(e == "follow-suggestions-dirty"){
                await this.setFollowSuggestionsDirty(did)
            }
        }
    }

    async getDirty() {
        const dirty = await this.cache.redis.smembers("follow-suggestions-dirty")
        this.cache.logger.pino.info({dirty}, "dirty")
        const requested = new Set((await this.cache.getKeysByPrefix(`follow-suggestions:`)).map(k => k.replace("follow-suggestions:", "")))

        return dirty.filter(did => requested.has(did))
    }
}


class FollowSuggestionsCacheKey extends CacheKey {
    async get(did: string): Promise<string[] | null> {
        const res = await this.cache.redis.get(this.key(did))
        return res ? JSON.parse(res) : null
    }

    key(did: string) {
        return `follow-suggestions:${did}`
    }

    async set(did: string, dids: string[]) {
        await this.cache.redis.set(
            this.key(did),
            JSON.stringify(dids)
        )
    }
}


class TimestampKey extends CacheKey {
    key: string
    defaultValue: Date

    constructor(cache: RedisCache, key: string, defaultValue: Date = new Date(0)) {
        super(cache)
        this.key = key
        this.defaultValue = defaultValue
    }

    async get(): Promise<Date> {
        const cur = await this.cache.redis.get(this.key)
        return cur ? new Date(cur) : this.defaultValue
    }

    async set(date: Date) {
        console.log(`Set ${this.key} to`, formatIsoDate(date))
        await this.cache.redis.set(this.key, date.toISOString())
    }

    async restart() {
        await this.set(new Date(0))
    }
}


export type MirrorStatus = "Sync" | "Dirty" | "InProcess" | "Failed" | "Failed - Too Large"

class MirrorStatusCacheKey extends CacheKey {
    mirrorId: string

    constructor(cache: RedisCache, mirrorId: string){
        super(cache)
        this.mirrorId = mirrorId
    }

    async clear() {
        await this.cache.deleteByPrefix(`${this.mirrorId}:mirror-status`)
    }

    key(did: string, inCA: boolean) {
        return `${this.mirrorId}:mirror-status:${did}:${inCA ? "ca" : "ext"}`
    }

    async set(did: string, mirrorStatus: MirrorStatus, inCA: boolean) {
        await this.cache.redis.set(
            this.key(did, inCA),
            mirrorStatus
        )
    }

    async get(did: string, inCA: boolean) {
        const res = await this.cache.redis.get(this.key( did, inCA))
        return res ? res as MirrorStatus : "Dirty"
    }
}

export type RedisEvent = "verification-update" | "follow-suggestions-ready" | "follow-suggestions-dirty"

export class RedisCache {
    redis: Redis
    keys: CacheKey[] = []
    logger: Logger
    followSuggestionsDirty: FollowSuggestionsDirtyCacheKey
    followSuggestions: FollowSuggestionsCacheKey
    CAFollows: CAFollowsCacheKey
    mirrorStatus: MirrorStatusCacheKey
    lastReferencesUpdate: TimestampKey
    lastTopicInteractionsUpdate: TimestampKey
    followingFeedSkeletonCAAll: FollowingFeedSkeletonKey
    followingFeedSkeletonCAArticles: FollowingFeedSkeletonKey
    profile: ProfileCacheKey

    constructor(redis: Redis, mirrorId: string, logger: Logger) {
        this.redis = redis
        this.followSuggestions = new FollowSuggestionsCacheKey(this)
        this.followSuggestionsDirty = new FollowSuggestionsDirtyCacheKey(this)
        this.mirrorStatus = new MirrorStatusCacheKey(this, mirrorId)
        this.lastReferencesUpdate = new TimestampKey(this, "last-references-update", new Date(0))
        this.lastTopicInteractionsUpdate = new TimestampKey(this, "last-topic-interactions-update", new Date(0))
        this.CAFollows = new CAFollowsCacheKey(this)
        this.followingFeedSkeletonCAAll = new FollowingFeedSkeletonKey(this, ["ca-all"])
        this.followingFeedSkeletonCAArticles = new FollowingFeedSkeletonKey(this, ["ca-articles"])
        this.profile = new ProfileCacheKey(this)
        this.logger = logger

        this.keys = [
            this.profile,
            this.followSuggestions,
            this.CAFollows,
            this.followSuggestionsDirty,
            this.followingFeedSkeletonCAAll,
            this.followingFeedSkeletonCAArticles,
        ]
    }

    async onUpdateRecords(uris: string[]) {
        for(const k of this.keys) {
            await k.onUpdateRecords(uris)
        }
    }

    async onEvent(e: RedisEvent, params: string[]) {
        for(const k of this.keys) {
            await k.onEvent(e, params)
        }
    }

    async deleteByPrefix(prefix: string) {
        const stream = this.redis.scanStream({
            match: `${prefix}*`,
            count: 100
        })

        stream.on("data", async (keys) => {
            if (keys.length) {
                const pipeline = this.redis.pipeline()
                keys.forEach((key: string) => pipeline.del(key))
                await pipeline.exec();
            }
        })
    }

    async getKeysByPrefix(prefix: string) {
        return this.redis.keys(`${prefix}*`)
    }
}

export const clearRedisHandler: CAHandler<{ params: { prefix: string } }, {}> = async (ctx, agent, {params}) => {
    console.log("Clearing redis prefix", params.prefix)
    await ctx.redisCache.deleteByPrefix(params.prefix)
    return {data: {}}
}