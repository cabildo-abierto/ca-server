import express from 'express'
import type {AppContext} from '#/index'
import {handler} from "#/utils/session-agent";
import {getFeedByKind} from "#/services/feed/feed";
import {getProfileFeed} from "#/services/feed/profile/profile";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function feedRoutes(ctx: AppContext) {
    router.get(
        '/feed/:kind',
        handler(makeHandler(ctx, getFeedByKind))
    )

    router.get(
        '/profile-feed/:handleOrDid/:kind',
        handler(makeHandler(ctx, getProfileFeed))
    )

    return router
}
