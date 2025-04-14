import express from 'express'
import type { AppContext } from '#/index'
import {cookieOptions, handler, Session} from "#/utils/utils";
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

    return router
}
