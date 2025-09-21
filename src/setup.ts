import type {OAuthClient} from '@atproto/oauth-client-node'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {PrismaClient} from '@prisma/client'
import {createServer} from "src/lex-server";
import {Server as XrpcServer} from "src/lex-server"
import Redis from "ioredis"
import {CAWorker} from "#/jobs/worker";
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { DB } from '#/../prisma/generated/types'
import { createClient as createSBClient, SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'
import {RedisCache} from "#/services/redis/cache";
import {Logger} from "#/utils/logger";


export type AppContext = {
    db: PrismaClient
    logger: Logger
    oauthClient: OAuthClient
    resolver: BidirectionalResolver
    xrpc: XrpcServer
    ioredis: Redis
    redisCache: RedisCache
    mirrorId: string
    worker: CAWorker | undefined
    kysely: Kysely<DB>
    sb: SupabaseClient
}


export type Role = "worker" | "web" | "mirror"

export const redisUrl = process.env.REDIS_URL as string
const env = process.env.NODE_ENV ?? "development"

export async function setupAppContext(roles: Role[]) {
    const logger = new Logger([...roles, env].join(":"))

    const db = new PrismaClient()
    logger.pino.info("prisma client created")

    const kysely = new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: process.env.DATABASE_URL,
            }),
        }),
    })
    logger.pino.info("kysely client created")

    const sb = createSBClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        global: {
            headers: {
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`
            }
        }
    })
    logger.pino.info("sb client created")

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

    const mirrorId = `mirror-${env}`
    logger.pino.info("Mirror ID", mirrorId)

    const redisCache = new RedisCache(ioredis, mirrorId)
    logger.pino.info("redis cache created")

    const ctx: AppContext = {
        db,
        logger,
        oauthClient,
        resolver,
        xrpc,
        ioredis: ioredis,
        redisCache,
        kysely,
        worker,
        sb,
        mirrorId
    }

    if(worker){
        await worker.setup(ctx)
        logger.pino.info("worker steup")
    }

    return {ctx, logger}
}