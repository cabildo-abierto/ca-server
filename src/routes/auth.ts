import express from 'express'
import { getIronSession } from 'iron-session'
import { isValidHandle } from '@atproto/syntax'
import type { AppContext } from '#/index'
import {cookieOptions, handler, Session} from "#/utils/session-agent";

const router = express.Router()

export default function authRoutes(ctx: AppContext) {
    // OAuth metadata
    router.get(
        '/client-metadata.json',
        handler((_req, res) => {
            return res.json(ctx.oauthClient.clientMetadata)
        })
    )

    router.post('/login', async (req, res) => {
        const handle = req.body?.handle
        if (typeof handle !== 'string' || !isValidHandle(handle)) {
            return res.status(200).send("Handle inválido.")
        }

        try {
            const url = await ctx.oauthClient.authorize(handle, {
                scope: 'atproto transition:generic',
            })
            return res.status(200).json({ url })
        } catch (err) {
            return res.status(400).send("Error al iniciar sesión.")
        }
    })

    router.get('/oauth/callback', async (req, res) => {
        const params = new URLSearchParams(req.originalUrl.split('?')[1])
        try {
            const { session } = await ctx.oauthClient.callback(params)
            const clientSession = await getIronSession<Session>(req, res, cookieOptions)
            clientSession.did = session.did
            await clientSession.save()
        } catch (err) {
            ctx.logger.error({ err }, 'oauth callback failed')
            return res.redirect('/?error')
        }
        return res.redirect('http://127.0.0.1:3000/inicio')
    })

    router.post('/logout', async (req, res) => {
        const session = await getIronSession<Session>(req, res, cookieOptions)
        session.destroy()
        return res.redirect('/')
    })

    return router
}
