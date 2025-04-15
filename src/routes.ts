import express from 'express'
import type {AppContext} from '#/index'
import authRoutes from "#/routes/auth";
import userRoutes from "#/routes/user";
import {feedRoutes} from "#/routes/feed";




export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

    router.use('/', authRoutes(ctx))
    router.use('/', userRoutes(ctx))
    feedRoutes(ctx)

    router.use(ctx.xrpc.xrpc.router)

    return router
}
