import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {getAccount, getProfile, getSession} from "#/services/user/users";
import {logTimes} from "#/utils/utils";

const router = express.Router()


export default function userRoutes(ctx: AppContext) {
    router.get(
        '/profile/:handleOrDid',
        handler(async (req, res) => {
            let {handleOrDid} = req.params

            const agent = await sessionAgent(req, res, ctx)
            if(!agent.hasSession()){
                return res.status(200).json({error: "No session"})
            } else if(!handleOrDid) {
                handleOrDid = agent.did
            }

            const {profile, error} = await getProfile(ctx, agent, handleOrDid)
            return res.json({data: profile, error})
        })
    )

    router.get(
        '/session',
        handler(async (req, res) => {
            const agent = await sessionAgent(req, res, ctx)
            if(!agent.hasSession()){
                return res.status(200).json({error: "No session"})
            } else {
                const {session, error} = await getSession(ctx, agent)
                return res.json({data: session, error})
            }
        })
    )

    router.get(
        '/account',
        handler(async (req, res) => {
            const agent = await sessionAgent(req, res, ctx)
            if(!agent.hasSession()){
                return res.status(200).json({error: "No session"})
            } else {
                const {account, error} = await getAccount(ctx, agent)
                return res.json({data: account, error})
            }
        })
    )


    return router
}
