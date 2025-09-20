import express from 'express'
import {cookieOptions, handler, Session, sessionAgent} from "#/utils/session-agent";
import {CAHandlerNoAuth, makeHandler, makeHandlerNoAuth} from "#/utils/handler";
import {searchTopics, searchUsers} from "#/services/search/search";
import {createArticle} from "#/services/write/article";
import {getIronSession} from "iron-session";
import {env} from "#/lib/env";
import {createAccessRequest, getInviteCodesToShare, login} from "#/services/user/access";
import {getFeedByKind} from "#/services/feed/feed";
import {getProfileFeed} from "#/services/feed/profile/profile";
import {
    clearFollows,
    deleteSession,
    follow,
    getAccount,
    getFollowers,
    getFollows,
    getProfile,
    getSession,
    setSeenTutorial,
    unfollow,
    updateAlgorithmConfig,
    updateProfile
} from "#/services/user/users";
import {createPost} from "#/services/write/post";
import {addLike, removeLike, removeRepost, repost} from "#/services/reactions/reactions";
import {getThread} from "#/services/thread/thread";
import {
    getTopicHandler,
    getTopicVersionHandler,
    getTrendingTopics,
    getTopicsHandler,
    getCategories,
    getTopicsMentioned
} from "#/services/wiki/topics";
import {getTopicFeed, getTopicMentionsInTopicsFeed, getTopicQuoteReplies} from "#/services/feed/topic";
import {deleteCAProfile, deleteRecordHandler, deleteRecordsHandler} from "#/services/delete";
import {getCategoriesGraph, getCategoryGraph} from "#/services/wiki/graph";
import {createTopicVersion} from "#/services/write/topic";
import path from "path";
import {cancelEditVote, voteEdit} from "#/services/wiki/votes";
import { adminRoutes } from './admin-routes';
import { fetchURLMetadata, getContentMetadata } from '#/services/write/metadata';
import {getDataset, getDatasets, getTopicsDatasetHandler } from '#/services/dataset/read';
import { createDataset } from '#/services/dataset/write';
import {searchContents} from "#/services/feed/search";
import {addToEnDiscusion, removeFromEnDiscusion} from "#/services/feed/inicio/discusion";
import {cancelValidationRequest, createValidationRequest, getValidationRequest } from '#/services/user/validation';
import {createPreference, getDonationHistory, getFundingStateHandler, getMonthlyValueHandler, processPayment} from '#/services/monetization/donations';
import { storeReadSession } from '#/services/monetization/read-tracking';
import { getTopicTitleHandler } from '#/services/wiki/current-version';
import {getTopicHistoryHandler} from "#/services/wiki/history";
import {getNewVersionDiff, getTopicVersionChanges} from '#/services/wiki/changes';
import {getNotifications, getUnreadNotificationsCount} from '#/services/notifications/notifications';
import {
    createConversation,
    getConversation,
    getConversations,
    markConversationRead,
    sendMessage
} from "#/services/messaging/conversations";
import {getDraft, getDrafts, saveDraft } from '#/services/write/drafts';
import { getNextMeeting } from '#/services/admin/meetings';
import { getAuthorDashboardHandler } from '#/services/monetization/author-dashboard';
import { getFollowSuggestions, setNotInterested } from '#/services/user/follow-suggestions';
import {AppContext} from "#/setup";


const serverStatusRouteHandler: CAHandlerNoAuth<{}, string> = async (ctx, agent, {}) => {
    return {data: "live"}
}


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
        handler(makeHandlerNoAuth(ctx, getFeedByKind))
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
        handler(makeHandlerNoAuth(ctx, searchUsers))
    )

    router.post(
        '/like',
        handler(makeHandler(ctx, addLike))
    )

    router.post(
        '/remove-like/:rkey',
        handler(makeHandler(ctx, removeLike))
    )

    router.post(
        '/repost',
        handler(makeHandler(ctx, repost))
    )

    router.post(
        '/remove-repost/:rkey',
        handler(makeHandler(ctx, removeRepost))
    )

    router.get(
        '/thread/:handleOrDid/:collection/:rkey',
        handler(makeHandlerNoAuth(ctx, getThread))
    )

    router.get(
        '/trending-topics/:time',
        handler(makeHandlerNoAuth(ctx, getTrendingTopics))
    )
    router.get(
        '/profile/:handleOrDid',
        handler(makeHandlerNoAuth(ctx, getProfile))
    )

    router.get("/test", makeHandlerNoAuth(ctx, serverStatusRouteHandler))

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
        '/follows/:handleOrDid',
        makeHandlerNoAuth(ctx, getFollows)
    )

    router.get(
        '/followers/:handleOrDid',
        makeHandlerNoAuth(ctx, getFollowers)
    )

    router.get(
        '/topic',
        makeHandlerNoAuth(ctx, getTopicHandler)
    )

    router.post(
        '/topic-version',
        makeHandler(ctx, createTopicVersion)
    )

    router.get(
        '/topic-version/:did/:rkey',
        makeHandlerNoAuth(ctx, getTopicVersionHandler)
    )

    router.get(
        '/topic-feed/:kind',
        makeHandlerNoAuth(ctx, getTopicFeed)
    )

    router.get(
        '/topic-mentions-in-topics-feed',
        makeHandlerNoAuth(ctx, getTopicMentionsInTopicsFeed)
    )

    router.get(
        '/topic-quote-replies/:did/:rkey',
        makeHandlerNoAuth(ctx, getTopicQuoteReplies)
    )


    router.get(
        '/topic-history/:id',
        makeHandlerNoAuth(ctx, getTopicHistoryHandler)
    )

    router.get(
        '/topic-version-changes/:curDid/:curRkey/:prevDid/:prevRkey',
        makeHandlerNoAuth(ctx, getTopicVersionChanges)
    )

    router.post(
        '/diff',
        makeHandlerNoAuth(ctx, getNewVersionDiff)
    )

    router.post(
        '/delete-records',
        makeHandler(ctx, deleteRecordsHandler)
    )

    router.post(
        '/delete-record/:collection/:rkey',
        makeHandler(ctx, deleteRecordHandler)
    )

    router.get(
        '/categories-graph',
        makeHandlerNoAuth(ctx, getCategoriesGraph)
    )

    router.get(
        '/category-graph',
        makeHandlerNoAuth(ctx, getCategoryGraph)
    )

    router.get(
        '/categories',
        makeHandlerNoAuth(ctx, getCategories)
    )

    router.get(
        '/topics/:sort/:time',
        makeHandlerNoAuth(ctx, getTopicsHandler)
    )

    router.get(
        '/search-topics/:q',
        makeHandlerNoAuth(ctx, searchTopics)
    )

    router.get(
        '/search-contents/:q',
        makeHandlerNoAuth(ctx, searchContents)
    )

    router.post(
        '/vote-edit/:vote/:did/:rkey/:cid',
        makeHandler(ctx, voteEdit)
    )

    router.post(
        '/cancel-edit-vote/:collection/:rkey',
        makeHandler(ctx, cancelEditVote)
    )

    router.post('/seen-tutorial/:tutorial',
        makeHandler(ctx, setSeenTutorial)
    )

    router.get('/datasets',
        makeHandlerNoAuth(ctx, getDatasets)
    )

    router.get('/dataset/:did/:collection/:rkey',
        makeHandlerNoAuth(ctx, getDataset)
    )

    router.post('/topics-dataset',
        makeHandlerNoAuth(ctx, getTopicsDatasetHandler)
    )

    router.post('/dataset',
        makeHandler(ctx, createDataset)
    )

    router.post('/set-en-discusion/:collection/:rkey',
        makeHandler(ctx, addToEnDiscusion)
    )

    router.post('/unset-en-discusion/:collection/:rkey',
        makeHandler(ctx, removeFromEnDiscusion)
    )

    router.post(
        '/get-topics-mentioned',
        makeHandlerNoAuth(ctx, getTopicsMentioned)
    )

    router.post(
        '/profile',
        handler(makeHandler(ctx, updateProfile))
    )

    router.post(
        '/validation-request',
        handler(makeHandler(ctx, createValidationRequest))
    )

    router.get(
        '/validation-request',
        handler(makeHandler(ctx, getValidationRequest))
    )

    router.post(
        '/validation-request/cancel',
        handler(makeHandler(ctx, cancelValidationRequest))
    )

    router.get('/metadata', makeHandler(ctx, fetchURLMetadata))

    router.get('/donation-history', makeHandler(ctx, getDonationHistory))

    router.get('/monthly-value', makeHandlerNoAuth(ctx, getMonthlyValueHandler))

    router.get('/funding-state', makeHandlerNoAuth(ctx, getFundingStateHandler))

    router.post('/donate/create-preference', makeHandler(ctx, createPreference))

    router.post('/notify-payment', makeHandlerNoAuth(ctx, processPayment))

    router.post('/read-session/:did/:collection/:rkey', makeHandlerNoAuth(ctx, storeReadSession))

    router.get("/topic-title/:id", makeHandlerNoAuth(ctx, getTopicTitleHandler))

    router.get("/notifications/list", makeHandler(ctx, getNotifications))

    router.get("/notifications/unread-count", makeHandler(ctx, getUnreadNotificationsCount))

    router.get("/conversations/list", makeHandler(ctx, getConversations))

    router.get("/conversation/:convoId", makeHandler(ctx, getConversation))

    router.post("/send-message", makeHandler(ctx, sendMessage))

    router.post("/conversation/create/:did", makeHandler(ctx, createConversation))

    router.post("/conversation/read/:convoId", makeHandler(ctx, markConversationRead))

    router.post("/access-request", makeHandlerNoAuth(ctx, createAccessRequest))

    router.post('/clear-follows', makeHandler(ctx, clearFollows))

    router.get('/drafts', makeHandler(ctx, getDrafts))

    router.get('/draft/:id', makeHandler(ctx, getDraft))

    router.post('/draft', makeHandler(ctx, saveDraft))

    router.get("/next-meeting", makeHandlerNoAuth(ctx, getNextMeeting))

    router.get("/invite-codes-to-share", makeHandler(ctx, getInviteCodesToShare))

    router.get("/content-metadata/:did/:collection/:rkey", makeHandlerNoAuth(ctx, getContentMetadata))

    router.post("/algorithm-config", makeHandler(ctx, updateAlgorithmConfig))

    router.get("/author-dashboard", makeHandler(ctx, getAuthorDashboardHandler))

    router.post("/delete-ca-profile", makeHandler(ctx, deleteCAProfile))

    router.get("/follow-suggestions/:limit/:cursor", makeHandler(ctx, getFollowSuggestions))

    router.post("/not-interested/:subject", makeHandler(ctx, setNotInterested))

    router.use(adminRoutes(ctx))

    router.use(ctx.xrpc.xrpc.router)

    return router
}
