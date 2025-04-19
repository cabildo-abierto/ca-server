import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";

const router = express.Router()


export default function visualizationRoutes(ctx: AppContext) {
    router.get(
        '/visualizations',
        handler(async (req, res) => {
            const agent = await sessionAgent(req, res, ctx)
            if(agent.hasSession()){
                return res.json({visualizations: []})
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    return router
}
