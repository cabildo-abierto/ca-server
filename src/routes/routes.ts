import express from 'express'
import type {AppContext} from '#/index'
import {cookieOptions, handler, Session, sessionAgent} from "#/utils/session-agent";
import {makeHandler, makeHandlerNoAuth} from "#/utils/handler";
import {searchTopics, searchUsers} from "#/services/search/search";
import {createArticle} from "#/services/write/article";
import {isValidHandle} from "@atproto/syntax";
import {getIronSession} from "iron-session";
import {env} from "#/lib/env";
import {getAvailableInviteCodes, login} from "#/services/user/access";
import {getFeedByKind} from "#/services/feed/feed";
import {getProfileFeed} from "#/services/feed/profile/profile";
import {
    deleteSession,
    follow,
    getAccount,
    getFollowers,
    getFollows,
    getProfile,
    getSession, setSeenTutorial,
    unfollow
} from "#/services/user/users";
import {createPost} from "#/services/write/post";
import {addLike, removeLike} from "#/services/reactions/like";
import {removeRepost, repost} from "#/services/reactions/repost";
import {getThread} from "#/services/thread/thread";
import {
    getTopicHandler,
    getTopicHistory,
    getTopicVersionHandler,
    getTopicVersionAuthors,
    getTopicVersionChanges,
    getTopTrendingTopics,
    getTopicsHandler,
    getCategories
} from "#/services/topic/topics";
import {getTopicFeed} from "#/services/feed/topic";
import {deleteRecord, deleteRecordsHandler} from "#/services/delete";
import {getCategoriesGraph, getCategoryGraph} from "#/services/topic/graph";
import {createTopicVersion} from "#/services/write/topic";
import path from "path";
import {cancelEditVote, voteEdit} from "#/services/topic/votes";
import { adminRoutes } from './admin-routes';
import { fetchURLMetadata } from '#/services/write/metadata';


export const createRouter = (ctx: AppContext) => {
    const router = express.Router()

    router.get('/client-metadata.json', (req, res, next) => {
        res.setHeader('Content-Type', 'application/json')
        return res.sendFile(path.join(process.cwd(), 'public', 'client-metadata.json'))
    })

    router.post('/login', makeHandlerNoAuth(ctx, login))

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
        return res.redirect(env.FRONTEND_URL+'/login/ok')
    })

    router.post('/logout', async (req, res) => {
        const agent = await sessionAgent(req, res, ctx)
        if(agent.hasSession()){
            await deleteSession(ctx, agent)
        }

        return res.status(200).json({})
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
        '/thread/:handleOrDid/:collection/:rkey',
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
        handler(makeHandlerNoAuth(ctx, getSession))
    )

    router.get(
        '/session/:code',
        handler(makeHandlerNoAuth(ctx, getSession))
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

    router.get(
        '/topic/:id',
        makeHandler(ctx, getTopicHandler)
    )

    router.post(
        '/topic-version',
        makeHandler(ctx, createTopicVersion)
    )

    router.get(
        '/topic-version/:did/:rkey',
        makeHandler(ctx, getTopicVersionHandler)
    )

    router.get(
        '/topic-feed/:id',
        makeHandler(ctx, getTopicFeed)
    )

    router.get(
        '/topic-history/:id',
        makeHandler(ctx, getTopicHistory)
    )

    router.get(
        '/topic-version-authors/:did/:rkey',
        makeHandler(ctx, getTopicVersionAuthors)
    )

    router.get(
        '/topic-version-changes/:did/:rkey',
        makeHandler(ctx, getTopicVersionChanges)
    )

    router.post(
        '/delete-records',
        makeHandler(ctx, deleteRecordsHandler)
    )

    router.post(
        '/delete-record',
        makeHandler(ctx, deleteRecord)
    )

    router.get(
        '/categories-graph',
        makeHandler(ctx, getCategoriesGraph)
    )

    router.get(
        '/category-graph/:c',
        makeHandler(ctx, getCategoryGraph)
    )

    router.get(
        '/categories',
        makeHandler(ctx, getCategories)
    )

    router.get(
        '/topics/:sort',
        makeHandler(ctx, getTopicsHandler)
    )

    router.get(
        '/search-topics/:q',
        makeHandler(ctx, searchTopics)
    )

    router.post(
        '/vote-edit/:vote/:id/:did/:rkey/:cid',
        makeHandler(ctx, voteEdit)
    )

    router.post(
        '/cancel-edit-vote/:id/:rkey',
        makeHandler(ctx, cancelEditVote)
    )

    router.post('/seen-tutorial',
        makeHandler(ctx, setSeenTutorial)
    )

    router.get('/metadata', makeHandler(ctx, fetchURLMetadata));

    router.use(adminRoutes(ctx))

    router.use(ctx.xrpc.xrpc.router)

    return router
}
