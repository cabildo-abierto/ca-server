import express from 'express'
import type {AppContext} from '#/index'
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function visualizationRoutes(ctx: AppContext) {
    router.get(
        '/visualizations',
        makeHandler(ctx, async () => ({data: []})),
    )

    return router
}
