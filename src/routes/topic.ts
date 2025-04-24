import express from 'express'
import type {AppContext} from '#/index'
import {handler} from "#/utils/session-agent";
import {getTopTrendingTopics} from "#/services/topic/topics";
import {makeHandler} from "#/utils/handler";

const router = express.Router()


export default function topicRoutes(ctx: AppContext) {
    router.get(
        '/trending-topics',
        handler(makeHandler(ctx, getTopTrendingTopics))
    )

    return router
}
