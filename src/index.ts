import events from 'node:events'
import type http from 'node:http'
import express, {type Express} from 'express'
import {pino} from 'pino'
import type {OAuthClient} from '@atproto/oauth-client-node'
import {Firehose} from '@atproto/sync'
import {env} from '#/lib/env'
import {createIngester} from '#/ingester'
import {createRouter} from '#/routes'
import {createClient} from '#/auth/client'
import {createBidirectionalResolver, createIdResolver, BidirectionalResolver} from '#/id-resolver'
import {PrismaClient} from '@prisma/client'
import cors from 'cors'
import path from 'path'
import {createServer} from "#/lexicon-server";
import {Server as XrpcServer} from "#/lexicon-server"


export type AppContext = {
    db: PrismaClient
    ingester: Firehose
    logger: pino.Logger
    oauthClient: OAuthClient
    resolver: BidirectionalResolver
    xrpc: XrpcServer
}

export class Server {
    constructor(
        public app: express.Application,
        public server: http.Server,
        public ctx: AppContext
    ) {}

    static async create() {
        const {NODE_ENV, HOST, PORT} = env

        const logger = pino({name: 'server start'})

        const db = new PrismaClient()

        const oauthClient = await createClient(db)
        const baseIdResolver = createIdResolver()
        const ingester = createIngester(db, baseIdResolver)
        const resolver = createBidirectionalResolver(baseIdResolver)
        const xrpc = createServer()
        const ctx = {
            db,
            ingester,
            logger,
            oauthClient,
            resolver,
            xrpc
        }

        ingester.start()

        const app: Express = express()
        app.set('trust proxy', true)
        app.use(cors({
            origin: (origin, callback) => {
                const allowedOrigins = ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:8080']
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
        app.use(express.static(path.join(__dirname, 'public')))

        const router = createRouter(ctx)
        app.use(router)
        app.use((_req, res) => res.sendStatus(404))

        const server = app.listen(env.PORT)
        await events.once(server, 'listening')
        logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`)

        return new Server(app, server, ctx)
    }

    async close() {
        this.ctx.logger.info('sigint received, shutting down')
        await this.ctx.ingester.destroy()
        return new Promise<void>((resolve) => {
            this.server.close(() => {
                this.ctx.logger.info('server closed')
                resolve()
            })
        })
    }
}

const run = async () => {
    const server = await Server.create()

    const onCloseSignal = async () => {
        setTimeout(() => process.exit(1), 10000).unref() // Force shutdown after 10s
        await server.close()
        process.exit()
    }

    process.on('SIGINT', onCloseSignal)
    process.on('SIGTERM', onCloseSignal)
}

run()
