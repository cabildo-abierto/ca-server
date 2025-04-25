import express from 'express'
import type {AppContext} from '#/index'
import {cookieOptions, handler, Session, sessionAgent} from "#/utils/session-agent";
import {makeHandler} from "#/utils/handler";
import {searchUsers} from "#/services/search/search";
import {createArticle} from "#/services/write/article";
import {isValidHandle} from "@atproto/syntax";
import {getIronSession} from "iron-session";
import {env} from "#/lib/env";
import {getAvailableInviteCodes} from "#/services/user/access";
import {getFeedByKind} from "#/services/feed/feed";
import {getProfileFeed} from "#/services/feed/profile/profile";
import {follow, getAccount, getFollowers, getFollows, getProfile, getSession, unfollow} from "#/services/user/users";
import {createPost} from "#/services/write/post";
import {addLike, removeLike} from "#/services/reactions/like";
import {removeRepost, repost} from "#/services/reactions/repost";
import {getThread} from "#/services/thread/thread";
import {getTopTrendingTopics} from "#/services/topic/topics";


export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

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
        return res.redirect(env.FRONTEND_URL+'/inicio')
    })

    router.post('/logout', async (req, res) => {
        const agent = await sessionAgent(req, res, ctx)
        if(agent.hasSession()){
            await ctx.oauthClient.revoke(agent.did)
            const session = await getIronSession<Session>(req, res, cookieOptions)
            session.destroy()
        }

        return res.status(200).json({})
    })

    router.get("/codes", async (req, res) => {
        const codes = await getAvailableInviteCodes(ctx)

        return {data: codes}
    })

    router.get(
        '/feed/:kind',
        handler(makeHandler(ctx, getFeedByKind))
    )

    router.get(
        '/profile-feed/:handleOrDid/:kind',
        handler(makeHandler(ctx, getProfileFeed))
    )

    router.post(
        '/follow',
        handler(makeHandler(ctx, follow))
    )

    router.post(
        '/unfollow',
        handler(makeHandler(ctx, unfollow))
    )

    router.post(
        '/article',
        handler(makeHandler(ctx, createArticle))
    )

    router.post(
        '/post',
        handler(makeHandler(ctx, createPost))
    )

    router.get(
        '/search-users/:query',
        handler(makeHandler(ctx, searchUsers))
    )

    router.post(
        '/like',
        handler(makeHandler(ctx, addLike))
    )

    router.post(
        '/remove-like',
        handler(makeHandler(ctx, removeLike))
    )

    router.post(
        '/repost',
        handler(makeHandler(ctx, repost))
    )

    router.post(
        '/remove-repost',
        handler(makeHandler(ctx, removeRepost))
    )

    router.get(
        '/thread/:did/:collection/:rkey',
        handler(makeHandler(ctx, getThread))
    )

    router.get(
        '/trending-topics',
        handler(makeHandler(ctx, getTopTrendingTopics))
    )
    router.get(
        '/profile/:handleOrDid',
        handler(makeHandler(ctx, getProfile))
    )

    router.get(
        '/session',
        handler(makeHandler(ctx, getSession))
    )

    router.get(
        '/account',
        handler(makeHandler(ctx, getAccount))
    )

    router.get(
        '/visualizations',
        makeHandler(ctx, async () => ({data: []})),
    )

    router.get(
        '/follows/:handleOrDid',
        makeHandler(ctx, getFollows)
    )

    router.get(
        '/followers/:handleOrDid',
        makeHandler(ctx, getFollowers)
    )

    router.use(ctx.xrpc.xrpc.router)

    return router
}
