import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getFeedByKind} from "#/services/feed/feed";
import {getProfileFeed} from "#/services/feed/profile/profile";

const router = express.Router()


export default function feedRoutes(ctx: AppContext) {
    router.get(
        '/feed/:kind',
        handler(async (req, res) => {
            const {kind} = req.params
            const agent = await sessionAgent(req, res, ctx)
            if(agent.hasSession()){
                const {feed, error} = await getFeedByKind({ctx, agent, kind})
                return res.json({data: feed, error})
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    router.get(
        '/profile-feed/:handleOrDid/:kind',
        handler(async (req, res) => {
            const {handleOrDid, kind} = req.params
            const agent = await sessionAgent(req, res, ctx)

            if(agent.hasSession()){
                const {feed, error} = await getProfileFeed(ctx, agent, handleOrDid, kind)
                return res.json({data: feed, error})
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    return router
}
