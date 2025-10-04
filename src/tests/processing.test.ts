import {RedisCache} from "#/services/redis/cache";
import {getRecordProcessor} from "#/services/sync/event-processing/get-record-processor";
import {AppContext, setupKysely, setupRedis, setupResolver} from "#/setup";
import {Logger} from "#/utils/logger";
import {AppBskyFeedPost, AppBskyGraphFollow, AtpBaseClient} from "@atproto/api";
import {getCollectionFromUri, getDidFromUri, getRkeyFromUri} from "#/utils/uri";
import {deleteUser} from "#/services/delete";
import {
    ReadChunks,
    ReadSession,
    storeReadSession
} from "#/services/monetization/read-tracking";
import {BaseAgent, bskyPublicAPI, SessionAgent} from "#/utils/session-agent";
import {env} from "#/lib/env";
import {sql} from "kysely";


async function createTestContext(): Promise<AppContext> {
    const ioredis = setupRedis(1)
    const logger = new Logger("test")
    const mirrorId = "test"
    const ctx: AppContext = {
        logger,
        kysely: setupKysely(process.env.TEST_DB),
        ioredis,
        resolver: setupResolver(ioredis),
        mirrorId,
        worker: undefined,
        storage: undefined,
        xrpc: undefined,
        oauthClient: undefined,
        redisCache: new RedisCache(ioredis, mirrorId, logger)
    }

    const result = await sql<{ dbName: string }>`SELECT current_database() as "dbName"`.execute(ctx.kysely);

    expect(result.rows[0].dbName).toBe('ca-sql-dev')

    return ctx
}

function getTestUser(i: number) {
    return `did:plc:test-${i}`
}


function getRefAndRecord<T>(collection: string, rkey: string, record: T) {
    return {
        ref: {
            uri: `at://${getTestUser(0)}/${collection}/${rkey}`,
            cid: "123"
        },
        record
    }
}


function getFollowRefAndRecord(subject: number, rkey: string = "test") {
    const record: AppBskyGraphFollow.Record = {
        $type: "app.bsky.graph.follow",
        subject: getTestUser(subject),
        createdAt: new Date().toISOString()
    }

    return getRefAndRecord("app.bsky.graph.follow", rkey, record)
}


async function cleanUpDBForTests(ctx: AppContext) {
    await deleteUser(ctx, getTestUser(0))
    await deleteUser(ctx, getTestUser(1))

}

async function cleanUpAfterTests(ctx: AppContext) {
    ctx.ioredis.disconnect()
    ctx.kysely.destroy()
}

describe('Process follow', () => {
    let follow: ReturnType<typeof getFollowRefAndRecord>
    let ctx : AppContext | undefined

    beforeAll(async () => {
        ctx = await createTestContext()

        await cleanUpDBForTests(ctx)

        const processor = getRecordProcessor(ctx, "app.bsky.graph.follow")

        follow = getFollowRefAndRecord(1)
        const records = [
            follow,
        ]

        await processor.process(records)
    })

    it("should create a record", async () => {
        const inserted = follow
        expect(ctx).not.toBeFalsy()

        const record = await ctx!.kysely
            .selectFrom("Record")
            .where(
                "uri",
                "=",
                inserted.ref.uri
            )
            .selectAll()
            .executeTakeFirst()

        expect(record).not.toBeNull()
        expect(record!.uri).toBe(inserted.ref.uri)
        expect(record!.cid).toBe(inserted.ref.cid)
        expect(record!.rkey).toBe(getRkeyFromUri(inserted.ref.uri))
        expect(record!.authorId).toBe(getDidFromUri(inserted.ref.uri))
        expect(record!.created_at_tz!.toISOString())
            .toBe(new Date(inserted.record.createdAt).toISOString())
        expect(record!.CAIndexedAt_tz).not.toBeNull()
    })

    afterAll(async () => cleanUpAfterTests(ctx!))
})


function getPostRecord(): AppBskyFeedPost.Record {
    return {
        $type: "app.bsky.feed.post",
        createdAt: new Date().toISOString(),
        text: "hola!"
    }
}


function getPostRefAndRecord() {
    const record = getPostRecord()

    return getRefAndRecord("app.bsky.feed.post", "test", record)
}


export class MockSessionAgent extends BaseAgent {
    did: string
    constructor(did: string){
        const CAAgent = new AtpBaseClient(`${env.HOST}:${env.PORT}`)
        super(CAAgent, new AtpBaseClient(bskyPublicAPI))
        this.did = did
    }

    hasSession(): this is SessionAgent {
        return true
    }
}


describe('Create read session', () => {
    const post = getPostRefAndRecord()
    const agent = new MockSessionAgent(getTestUser(0))

    let ctx : AppContext | undefined
    beforeAll(async () => {
        ctx = await createTestContext()
    })

    beforeEach(async () => {
        await cleanUpDBForTests(ctx!)
    })

    it("should create a read session", async () => {
        expect(ctx).not.toBeFalsy()
        let id: string | undefined
        let created_at = new Date()

        const chunks: ReadChunks = []
        const rs: ReadSession = {
            contentUri: post.ref.uri,
            chunks,
            totalChunks: 10
        }

        await getRecordProcessor(ctx!, getCollectionFromUri(post.ref.uri)).process([post])
        id = (await storeReadSession(ctx!, agent, rs, created_at)).id

        expect(id).not.toBeNull()
        const db_rs = await ctx!.kysely
            .selectFrom("ReadSession")
            .where(
                "id",
                "=",
                id!
            )
            .selectAll()
            .executeTakeFirst()

        expect(db_rs).not.toBeFalsy()
        expect(db_rs!.created_at_tz?.toISOString()).toEqual(created_at.toISOString())
        expect(db_rs!.readChunks).toEqual({chunks: rs.chunks, totalChunks: rs.totalChunks})
        expect(db_rs!.contentAuthorId).toEqual(getDidFromUri(post.ref.uri))
        expect(db_rs!.readContentId).toEqual(post.ref.uri)
        expect(db_rs!.userId).toEqual(getDidFromUri(post.ref.uri))
        expect(db_rs!.topicId).toBeNull()
    })

    afterAll(async () => cleanUpAfterTests(ctx!))
})