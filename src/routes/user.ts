import express from 'express'
import type { AppContext } from '#/index'
import {cookieOptions, getSessionAgent, handler, Session} from "#/utils/utils";
import {getIronSession} from "iron-session";

const router = express.Router()

export default function userRoutes(ctx: AppContext) {

    router.get(
        '/user/:did?',
        handler(async (req, res) => {
            let {did} = req.params

            if(!did){
                const session = await getIronSession<Session>(req, res, cookieOptions)
                did = session.did
            }

            const user = await ctx.db.user.findUnique({
                select: {
                    did: true,
                    handle: true,
                    displayName: true,
                    avatar: true
                },
                where: {
                    did
                }
            })

            return res.json(user)
        })
    )

    router.get(
        '/feed/:did?',
        handler(async (req, res) => {
            let {did} = req.params

            if(!did){
                const session = await getIronSession<Session>(req, res, cookieOptions)
                did = session.did
            }

            const agent = await getSessionAgent(req, res, ctx)

            if(agent){
                try {
                    const feedRes = await agent.ar.cabildoabierto.feed.getFeed({feed: "discusion"})
                    if(feedRes.success){
                        return res.json(feedRes.data.feed)
                    } else {
                        console.log(feedRes)
                        return res.json({error: "error"})
                    }
                } catch (err) {
                    console.log(err)
                    return res.json({error: "runtime error"})
                }
            } else {
                return res.status(401).send('Not authorized')
            }

        })
    )

    return router
}
