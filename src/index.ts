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
import path from 'path'
import {createServer} from "src/lex-server";
import {Server as XrpcServer} from "src/lex-server"
import {MirrorMachine} from "#/services/sync/mirror-machine";
import {createClient as createRedisClient, RedisClientType} from "redis"


const redisUrl = process.env.REDIS_URL || 'redis://localhost:16379'


export type AppContext = {
    db: PrismaClient
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
    ) {
    }

    static async create() {
        const {NODE_ENV, HOST, PORT} = env

        const logger = pino({name: 'server start'})

        const db = new PrismaClient()

        const redisDB: RedisClientType = createRedisClient({
            url: redisUrl,
            password: process.env.REDIS_PASSWORD
        })
        redisDB.on("error", function(err) {
            throw err;
        });
        await redisDB.connect()

        const oauthClient = await createClient(redisDB)


        const baseIdResolver = createIdResolver()
        const resolver = createBidirectionalResolver(baseIdResolver)
        const xrpc = createServer()
        const ctx = {
            db,
            logger,
            oauthClient,
            resolver,
            xrpc
        }

        const ingester = new MirrorMachine(ctx)
        ingester.run()

        const app: Express = express()
        app.set('trust proxy', true)

        const allowedOrigins = [
            'http://127.0.0.1:3000',
            'http://localhost:3000',
            'http://localhost:8080',
            'http://127.0.0.1:8080',
            'https://cabildoabierto.ar',
            'https://www.cabildoabierto.ar',
            'https://ca-withered-wind.fly.dev',
            'https://api.cabildoabierto.ar',
            'https://dev0.cabildoabierto.ar'
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
