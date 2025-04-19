import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";

const router = express.Router()


export default function testRoutes(ctx: AppContext) {
    router.get(
        '/test',
        handler(async (req, res) => {

            const t1 = Date.now()
            const {bskyAgent} = await sessionAgent(req, res, ctx)
            const t2 = Date.now()

            if(bskyAgent){
                const user = await bskyAgent.getProfile({actor: "cabildoabierto.com.ar"})
                return res.json({user, viewerDid: bskyAgent.did})
            }

            return res.json({error: "No bluesky agent"})
        })
    )

    return router
}
