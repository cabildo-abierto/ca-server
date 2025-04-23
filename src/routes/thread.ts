import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getUri, getValidUri} from "#/utils/uri";
import {getThread} from "#/services/thread/thread";

const router = express.Router()


export default function threadRoutes(ctx: AppContext) {
    router.get(
        '/thread/:did/:collection/:rkey',
        handler(async (req, res) => {
            const {did, collection, rkey} = req.params
            const agent = await sessionAgent(req, res, ctx)
            if (agent.hasSession()) {
                const uri = await getValidUri(agent, did, collection, rkey)
                const {thread, error} = await getThread(ctx, agent, uri)
                return res.json({data: thread, error})
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    return router
}
