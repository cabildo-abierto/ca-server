import {pino} from 'pino'
import type {OAuthClient} from '@atproto/oauth-client-node'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {PrismaClient} from '@prisma/client'
import {createServer} from "src/lex-server";
import {Server as XrpcServer} from "src/lex-server"
import {MirrorMachine} from "#/services/sync/mirror-machine";
import Redis from "ioredis"
import {CAWorker} from "#/jobs/worker";
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { DB } from '#/../prisma/generated/types'
import { createClient as createSBClient, SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

export const redisUrl = process.env.REDIS_URL as string


export type AppContext = {
    db: PrismaClient
    logger: pino.Logger
    oauthClient: OAuthClient
    resolver: BidirectionalResolver
    xrpc: XrpcServer
    ioredis: Redis
    mirrorId: string
    worker: CAWorker | undefined
    kysely: Kysely<DB>
    sb: SupabaseClient
}


export async function setupAppContext(roles: Role[]) {
    const logger = pino({name: 'server start'})

    const db = new PrismaClient()

    const ioredis = new Redis(redisUrl, {maxRetriesPerRequest: null, family: 6})

    const kysely = new Kysely<DB>({
        dialect: new PostgresDialect({
            pool: new Pool({
                connectionString: process.env.DATABASE_URL,
            }),
        }),
    })

    const sb = createSBClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        global: {
            headers: {
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`
            }
        }
    })

    const oauthClient = await createClient(ioredis)

    const baseIdResolver = createIdResolver()
    const resolver = createBidirectionalResolver(baseIdResolver, ioredis)
    const xrpc = createServer()

    let worker: CAWorker | undefined = new CAWorker(ioredis, roles.includes("worker"))

    const mirrorId = `mirror-${process.env.NODE_ENV ?? "development"}`

    const ctx: AppContext = {
        db,
        logger,
        oauthClient,
        resolver,
        xrpc,
        ioredis: ioredis,
        kysely,
        worker,
        sb,
        mirrorId
    }

    if(worker){
        await worker.setup(ctx)
    }

    return {ctx, logger}
}


export type Role = "worker" | "web" | "mirror"

export const run = async (roles: Role[]) => {
    const {ctx} = await setupAppContext(roles)

    if(roles.includes("mirror")){
        const ingester = new MirrorMachine(ctx)
        await ingester.run()
    }
}
