import express from 'express'
import type {AppContext} from '#/index'
import {handler} from "#/utils/session-agent";
import {follow, unfollow} from "#/services/user/users";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function followRoutes(ctx: AppContext) {
    router.post(
        '/follow',
        handler(makeHandler(ctx, follow))
    )

    router.post(
        '/unfollow',
        handler(makeHandler(ctx, unfollow))
    )

    return router
}
