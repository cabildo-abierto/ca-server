import type {OAuthClient} from '@atproto/oauth-client-node'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {createServer} from "src/lex-server";
import {Server as XrpcServer} from "src/lex-server"
import Redis from "ioredis"
import {CAWorker} from "#/jobs/worker";
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { DB } from '#/../prisma/generated/types'
import 'dotenv/config'
import {RedisCache} from "#/services/redis/cache";
import {Logger} from "#/utils/logger";
import { env } from './lib/env';
import { S3Storage } from './services/storage/storage';


export type AppContext = {
    logger: Logger
    oauthClient: OAuthClient
    resolver: BidirectionalResolver
    xrpc: XrpcServer
    ioredis: Redis
    redisCache: RedisCache
    mirrorId: string
    worker: CAWorker | undefined
    kysely: Kysely<DB>
    storage: S3Storage
}


export type Role = "worker" | "web" | "mirror"

export const redisUrl = env.REDIS_URL
const envName = env.NODE_ENV

export async function setupAppContext(roles: Role[]) {
    const logger = new Logger([...roles, envName].join(":"))

    const kysely = new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: env.DATABASE_URL,
                max: env.MAX_CONNECTIONS,
                idleTimeoutMillis: 30000,
                keepAlive: true,
            })
        })
    })
    logger.pino.info("kysely client created")

    const storage = new S3Storage(logger)
    logger.pino.info("storage client created")

    const ioredis = new Redis(redisUrl, {maxRetriesPerRequest: null, family: 6})
    logger.pino.info("redis client created")

    const oauthClient = await createClient(ioredis)
    logger.pino.info("oauth client created")

    let worker: CAWorker = new CAWorker(
        ioredis,
        roles.includes("worker"),
        logger
    )

    const baseIdResolver = createIdResolver()
    const resolver = createBidirectionalResolver(baseIdResolver, ioredis)
    const xrpc = createServer()
    logger.pino.info("xrpc server created")

    const mirrorId = `mirror-${envName}`
    logger.pino.info("Mirror ID", mirrorId)

    const redisCache = new RedisCache(ioredis, mirrorId, logger)
    logger.pino.info("redis cache created")

    const ctx: AppContext = {
        logger,
        oauthClient,
        resolver,
        xrpc,
        ioredis: ioredis,
        redisCache,
        kysely,
        worker,
        storage,
        mirrorId
    }

    if(worker){
        await worker.setup(ctx)
        logger.pino.info("worker steup")
    }

    return {ctx, logger}
}