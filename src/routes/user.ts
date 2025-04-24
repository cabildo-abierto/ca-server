import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getAccount, getProfile, getSession} from "#/services/user/users";
import {logTimes} from "#/utils/utils";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function userRoutes(ctx: AppContext) {
    router.get(
        '/profile/:handleOrDid',
        handler(makeHandler(ctx, getProfile))
    )

    router.get(
        '/session',
        handler(makeHandler(ctx, getSession))
    )

    router.get(
        '/account',
        handler(makeHandler(ctx, getAccount))
    )

    return router
}
