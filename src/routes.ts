import express from 'express'
import type {AppContext} from '#/index'
import authRoutes from "#/routes/auth";
import userRoutes from "#/routes/user";
import feedRoutes from "#/routes/feed";
import articleRoutes from "#/routes/article";
import visualizationRoutes from "#/routes/visualization";
import threadRoutes from "#/routes/thread";
import topicRoutes from "#/routes/topic";
import postRoutes from "#/routes/post";
import reactionRoutes from "#/routes/reaction";
import followRoutes from "#/routes/follow";


export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

    router.use('/', authRoutes(ctx))
    router.use('/', userRoutes(ctx))
    router.use('/', feedRoutes(ctx))
    router.use('/', articleRoutes(ctx))
    router.use('/', visualizationRoutes(ctx))
    router.use('/', threadRoutes(ctx))
    router.use('/', topicRoutes(ctx))
    router.use('/', postRoutes(ctx))
    router.use('/', reactionRoutes(ctx))
    router.use('/', followRoutes(ctx))

    router.use(ctx.xrpc.xrpc.router)

    return router
}
