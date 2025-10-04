import type {OAuthClient} from '@atproto/oauth-client-node'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {createServer} from "../src/lex-server";
import {Server as XrpcServer} from "../src/lex-server"
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
import {getCAUsersDids} from "#/services/user/users";


export type AppContext = {
    logger: Logger
    oauthClient: OAuthClient | undefined
    resolver: BidirectionalResolver
    xrpc: XrpcServer | undefined
    ioredis: Redis
    redisCache: RedisCache
    mirrorId: string
    worker: CAWorker | undefined
    kysely: Kysely<DB>
    storage: S3Storage | undefined
}


export type Role = "worker" | "web" | "mirror"

export const redisUrl = env.REDIS_URL
const envName = env.NODE_ENV


export function setupKysely(dbUrl?: string) {
    return new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: dbUrl ?? env.DATABASE_URL,
                max: env.MAX_CONNECTIONS,
                idleTimeoutMillis: 30000,
                keepAlive: true,
            })
        })
    })
}


export function setupRedis(db: number) {
    return new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        family: 6,
        db
    })
}


export function setupResolver(ioredis: Redis) {
    const baseIdResolver = createIdResolver()
    return createBidirectionalResolver(baseIdResolver, ioredis)
}


export async function setupAppContext(roles: Role[]) {
    const logger = new Logger([...roles, envName].join(":"))

    const kysely = setupKysely()
    logger.pino.info("kysely client created")

    const storage = new S3Storage(logger)
    logger.pino.info("storage client created")

    const ioredis = setupRedis(0)
    logger.pino.info("redis client created")

    const oauthClient = await createClient(ioredis)
    logger.pino.info("oauth client created")

    let worker: CAWorker | undefined
    if(roles.length > 0){
        worker = new CAWorker(
            ioredis,
            roles.includes("worker"),
            logger
        )
    }

    const resolver = setupResolver(ioredis)
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

        if(env.RUN_CRONS){
            ctx.logger.pino.info("adding sync ca users jobs")
            const caUsers = await getCAUsersDids(ctx)
            for(const u of caUsers){
                await worker.addJob("sync-user", {handleOrDid: u}, 21)
            }
        }


        logger.pino.info("worker setup")
    }

    return {ctx, logger}
}