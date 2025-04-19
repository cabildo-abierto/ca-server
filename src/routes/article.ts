import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {createArticle} from "#/services/write/article";

const router = express.Router()

export type CreateArticleProps = {
    title: string
    format: string
    text: string
}


export default function articleRoutes(ctx: AppContext) {
    router.post(
        '/article',
        handler(async (req, res) => {
            const body = req.body as CreateArticleProps
            const agent = await sessionAgent(req, res, ctx)
            if(agent.hasSession()){
                const {error} = await createArticle(ctx, agent, body)
                if(error) {
                    return res.json({error})
                } else {
                    return res.json({})
                }
            } else {
                return res.json({error: "No session"})
            }
        })
    )

    return router
}
