import events from 'node:events'
import type http from 'node:http'
import express, {type Express} from 'express'
import {pino} from 'pino'
import type {OAuthClient} from '@atproto/oauth-client-node'
import {env} from '#/lib/env'
import {createRouter} from '#/routes/routes'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {PrismaClient} from '@prisma/client'
import cors from 'cors'
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

    let worker: CAWorker = new CAWorker(ioredis, roles.includes("worker"))

    const mirrorId = `mirror-${process.env.NODE_ENV ?? "development"}`
    console.log("Mirror ID", mirrorId)

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

export class Server {
    constructor(
        public app: express.Application,
        public server: http.Server,
        public ctx: AppContext
    ) {
    }

    static async create(roles: Role[]) {
        const {NODE_ENV, HOST, PORT} = env

        const {ctx} = await setupAppContext(roles)

        if(roles.includes("mirror")){
            const ingester = new MirrorMachine(ctx)
            ingester.run()
        }

        const app: Express = express()
        app.set('trust proxy', true)

        app.use(express.json({ limit: "50mb" })) // TO DO: Mejorar

        const allowedOrigins = [
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3002',
            'http://localhost:3000',
            'http://localhost:8080',
            'http://127.0.0.1:8080',
            'https://cabildoabierto.ar',
            'https://cabildoabierto.com.ar',
            'https://www.cabildoabierto.ar',
            'https://www.cabildoabierto.com.ar',
            'https://ca-withered-wind.fly.dev',
            'https://api.cabildoabierto.ar',
            'https://dev0.cabildoabierto.ar',
            'https://fly-ca-withered-wind-redis.upstash.io',
            'http://192.168.0.10:3000',
            'http://192.168.0.11:3000',
            'http://192.168.0.34:3000',
            'http://192.168.1.4:3000',
            'http://0.0.0.0:3000'
        ]

        app.use(cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true)
                } else {
                    callback(new Error('Not allowed by CORS'))
                }
            },
            credentials: true,
        }))

        app.use(express.json())
        app.use(express.urlencoded({extended: true}))

        const morgan = require("morgan")
        app.use(morgan('combined'))

        const router = createRouter(ctx)
        app.use(router)
        app.use(express.static('public'))
        app.use((_req, res) => res.sendStatus(404))

        const server = app.listen(env.PORT, HOST)
        await events.once(server, 'listening')
        console.log(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`)

        return new Server(app, server, ctx)
    }

    async close() {
        this.ctx.logger.info('sigint received, shutting down')
        return new Promise<void>((resolve) => {
            this.server.close(() => {
                this.ctx.logger.info('server closed')
                resolve()
            })
        })
    }
}

export type Role = "worker" | "web" | "mirror"

export const run = async (roles: Role[]) => {
    const server = await Server.create(roles)

    const onCloseSignal = async () => {
        setTimeout(() => process.exit(1), 10000).unref() // Force shutdown after 10s
        await server.close()
        process.exit()
    }

    process.on('SIGINT', onCloseSignal)
    process.on('SIGTERM', onCloseSignal)
}

run(["web"])
