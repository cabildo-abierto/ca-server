import express from 'express'
import type {AppContext} from '#/index'
import authRoutes from "#/routes/auth";
import userRoutes from "#/routes/user";
import testRoutes from "#/routes/test";
import feedRoutes from "#/routes/feed";
import articleRoutes from "#/routes/article";
import visualizationRoutes from "#/routes/visualization";




export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

    router.use('/', authRoutes(ctx))
    router.use('/', userRoutes(ctx))
    router.use('/', testRoutes(ctx))
    router.use('/', feedRoutes(ctx))
    router.use('/', articleRoutes(ctx))
    router.use('/', visualizationRoutes(ctx))

    router.use(ctx.xrpc.xrpc.router)

    return router
}
