import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getFeedByKind} from "#/services/feed/feed";

const router = express.Router()


export default function feedRoutes(ctx: AppContext) {
    router.get(
        '/feed/:kind',
        handler(async (req, res) => {
            const {kind} = req.params
            const agent = await sessionAgent(req, res, ctx)
            if(agent.hasSession()){
                const feed = await getFeedByKind({ctx, agent, kind})
                return res.json(feed)
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    return router
}
