import {AppContext} from "#/index";
import {CAHandler} from "#/utils/handler";
import {unique} from "#/utils/arrays";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri} from "#/utils/uri";
import {isLike} from "@atproto/api/dist/client/types/app/bsky/feed/getLikes";
import {isRecord as isRepost} from "@atproto/api/dist/client/types/app/bsky/feed/repost";
import {ReactionType} from "#/services/reactions/reactions";


export const updateEngagementCountsHandler: CAHandler = async (ctx, agent, params) => {
    console.log("Added update engagement counts to queue.")
    await ctx.queue.add("update-engagement-counts", {})

    return {data: {}}
}


export async function updateEngagementCounts(ctx: AppContext) {
    console.log("Updating engagement counts...")
    const t1 = Date.now()

    await ctx.kysely.transaction().execute(async (trx) => {
        const reactionCounts: { uri: string, reactionType: string, count: string | number | bigint }[] =
            await trx
                .selectFrom('HasReacted')
                .innerJoin('Record', 'Record.uri', 'HasReacted.recordId')
                .select([
                    'Record.uri',
                    'HasReacted.reactionType',
                    (eb) => eb.fn.count('HasReacted.reactionType').as('count')
                ])
                .groupBy(['Record.uri', 'HasReacted.reactionType'])
                .execute()

        const updatesMap = new Map<string, Partial<{
            uniqueLikesCount: number
            uniqueRepostsCount: number
            uniqueAcceptsCount: number
            uniqueRejectsCount: number
        }>>()

        for (const { uri, reactionType, count } of reactionCounts) {
            const current = updatesMap.get(uri) ?? {}
            if(reactionType == "app.bsky.feed.like") current.uniqueLikesCount = Number(count)
            if(reactionType == "app.bsky.feed.repost") current.uniqueRepostsCount = Number(count)
            if(reactionType == "ar.cabildoabierto.wiki.voteAccept") current.uniqueAcceptsCount = Number(count)
            if(reactionType == "ar.cabildoabierto.wiki.voteReject") current.uniqueRejectsCount = Number(count)
            updatesMap.set(uri, current)
        }

        const records = Array.from(updatesMap.entries()).map(([uri, updates]) => ({
            ...updates,
            uri,
            authorId: getDidFromUri(uri),
            rkey: getRkeyFromUri(uri),
            collection: getCollectionFromUri(uri)
        }))

        const batchSize = 1000
        for(let i = 0; i < records.length; i += batchSize){
            const batch = records.slice(i, i + batchSize)
            console.log(`Updating batch starting at ${i} of ${records.length} records.`)
            await trx
                .insertInto("Record")
                .values(batch)
                .onConflict((oc) => oc.column("uri").doUpdateSet({
                    uniqueLikesCount: eb => eb.ref("excluded.uniqueLikesCount"),
                    uniqueRepostsCount: eb => eb.ref("excluded.uniqueRepostsCount"),
                    uniqueAcceptsCount: eb => eb.ref("excluded.uniqueAcceptsCount"),
                    uniqueRejectsCount: eb => eb.ref("excluded.uniqueRejectsCount"),
                }))
                .execute()
        }

    })

    console.log(`Engagement counts updated after ${Date.now() - t1} ms.`)
}

