import express from 'express'
import type {AppContext} from '#/index'
import {handler} from "#/utils/session-agent";
import {getThread} from "#/services/thread/thread";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function threadRoutes(ctx: AppContext) {
    router.get(
        '/thread/:did/:collection/:rkey',
        handler(makeHandler(ctx, getThread))
    )

    return router
}
