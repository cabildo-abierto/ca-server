import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {addLike, removeLike, RemoveLikeProps} from "#/services/reactions/like";
import {ATProtoStrongRef} from "#/lib/types";
import {removeRepost, RemoveRepostProps, repost} from "#/services/reactions/repost";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function reactionRoutes(ctx: AppContext) {
    router.post(
        '/like',
        handler(makeHandler(ctx, addLike))
    )

    router.post(
        '/remove-like',
        handler(makeHandler(ctx, removeLike))
    )

    router.post(
        '/repost',
        handler(makeHandler(ctx, repost))
    )

    router.post(
        '/remove-repost',
        handler(makeHandler(ctx, removeRepost))
    )

    return router
}
