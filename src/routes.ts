import express from 'express'
import type {AppContext} from '#/index'
import authRoutes from "#/routes/auth";
import userRoutes from "#/routes/user";




export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

    router.use('/', authRoutes(ctx))
    router.use('/', userRoutes(ctx))

    return router
}
