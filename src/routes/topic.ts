import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getUri, getValidUri} from "#/utils/uri";
import {getThread} from "#/services/thread/thread";
import {getTrendingTopics} from "#/services/topic/topics";

const router = express.Router()


export default function topicRoutes(ctx: AppContext) {
    router.get(
        '/trending-topics',
        handler(async (req, res) => {
            const {error, topics} = await getTrendingTopics(ctx, [], "popular", 10)
            return res.json({error, data: topics})
        })
    )

    return router
}
