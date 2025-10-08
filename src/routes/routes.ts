import express from 'express'
import {cookieOptions, handler, Session, sessionAgent} from "#/utils/session-agent.js";
import {CAHandlerNoAuth, makeHandler, makeHandlerNoAuth} from "#/utils/handler.js";
import {searchTopics, searchUsers, searchUsersAndTopics} from "#/services/search/search.js";
import {createArticle} from "#/services/write/article.js";
import {getIronSession} from "iron-session";
import {env} from "#/lib/env.js";
import {createAccessRequest, getInviteCodesToShare, login} from "#/services/user/access.js";
import {getFeedByKind} from "#/services/feed/feed.js";
import {getProfileFeed} from "#/services/feed/profile/profile.js";
import {
    clearFollowsHandler,
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
} from "#/services/user/users.js";
import {createPost} from "#/services/write/post.js";
import {addLike, removeLike, removeRepost, repost} from "#/services/reactions/reactions.js";
import {getThread} from "#/services/thread/thread.js";
import {getLikes, getReposts, getQuotes} from "#/services/thread/get-details.js";
import {
    getTopicHandler,
    getTopicVersionHandler,
    getTrendingTopics,
    getTopicsHandler,
    getCategories,
    getTopicsMentioned
} from "#/services/wiki/topics.js";
import {getTopicFeed, getTopicMentionsInTopicsFeed, getTopicQuoteReplies} from "#/services/feed/topic.js";
import {deleteCAProfile, deleteRecordHandler, deleteRecordsHandler} from "#/services/delete.js";
import {getCategoriesGraph, getCategoryGraph} from "#/services/wiki/graph.js";
import {createTopicVersion} from "#/services/write/topic.js";
import path from "path";
import {cancelEditVote, voteEdit} from "#/services/wiki/votes.js";
import { adminRoutes } from './admin-routes.js';
import { fetchURLMetadataHandler, getContentMetadata } from '#/services/write/metadata.js';
import {getDataset, getDatasets, getTopicsDatasetHandler } from '#/services/dataset/read.js';
import { createDataset } from '#/services/dataset/write.js';
import {searchContents} from "#/services/feed/search.js";
import {addToEnDiscusion, removeFromEnDiscusion} from "#/services/feed/inicio/discusion.js";
import {cancelValidationRequest, createValidationRequest, getValidationRequest } from '#/services/user/validation.js';
import {createPreference, getDonationHistory, getFundingStateHandler, getMonthlyValueHandler, processPayment} from '#/services/monetization/donations.js';
import { storeReadSessionHandler } from '#/services/monetization/read-tracking.js';
import { getTopicTitleHandler } from '#/services/wiki/current-version.js';
import {getTopicHistoryHandler} from "#/services/wiki/history.js";
import {getNewVersionDiff, getTopicVersionChanges} from '#/services/wiki/changes.js';
import {getNotifications, getUnreadNotificationsCount} from '#/services/notifications/notifications.js';
import {
    createConversation,
    getConversation,
    getConversations,
    markConversationRead,
    sendMessage
} from "#/services/messaging/conversations.js";
import {getDraft, getDrafts, saveDraft } from '#/services/write/drafts.js';
import { getNextMeeting } from '#/services/admin/meetings.js';
import { getAuthorDashboardHandler } from '#/services/monetization/author-dashboard.js';
import { getFollowSuggestions, setNotInterested } from '#/services/user/follow-suggestions.js';
import {AppContext} from "#/setup.js";


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
        if(!ctx.oauthClient) return
        const params = new URLSearchParams(req.originalUrl.split('?')[1])
        try {
            const { session } = await ctx.oauthClient.callback(params)
            const clientSession = await getIronSession<Session>(req, res, cookieOptions)
            clientSession.did = session.did
            await clientSession.save()
        } catch (err) {
            ctx.logger.pino.error({ error: err }, 'oauth callback failed')
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
        handler(makeHandlerNoAuth(ctx, getProfileFeed))
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

    router.get(
        '/search-users-and-topics/:query',
        handler(makeHandlerNoAuth(ctx, searchUsersAndTopics))
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

    router.post('/metadata', makeHandler(ctx, fetchURLMetadataHandler))

    router.get('/donation-history', makeHandler(ctx, getDonationHistory))

    router.get('/monthly-value', makeHandlerNoAuth(ctx, getMonthlyValueHandler))

    router.get('/funding-state', makeHandlerNoAuth(ctx, getFundingStateHandler))

    router.post('/donate/create-preference', makeHandlerNoAuth(ctx, createPreference))

    router.post('/notify-payment', makeHandlerNoAuth(ctx, processPayment))

    router.post('/read-session/:did/:collection/:rkey', makeHandlerNoAuth(ctx, storeReadSessionHandler))

    router.get("/topic-title/:id", makeHandlerNoAuth(ctx, getTopicTitleHandler))

    router.get("/notifications/list", makeHandler(ctx, getNotifications))

    router.get("/notifications/unread-count", makeHandler(ctx, getUnreadNotificationsCount))

    router.get("/conversations/list", makeHandler(ctx, getConversations))

    router.get("/conversation/:convoId", makeHandler(ctx, getConversation))

    router.post("/send-message", makeHandler(ctx, sendMessage))

    router.post("/conversation/create/:did", makeHandler(ctx, createConversation))

    router.post("/conversation/read/:convoId", makeHandler(ctx, markConversationRead))

    router.post("/access-request", makeHandlerNoAuth(ctx, createAccessRequest))

    router.post('/clear-follows', makeHandler(ctx, clearFollowsHandler))

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

    router.get("/likes/:did/:collection/:rkey", makeHandlerNoAuth(ctx, getLikes))

    router.get("/reposts/:did/:collection/:rkey", makeHandlerNoAuth(ctx, getReposts))

    router.get("/quotes/:did/:collection/:rkey", makeHandlerNoAuth(ctx, getQuotes))

    router.post("/not-interested/:subject", makeHandler(ctx, setNotInterested))

    router.use(adminRoutes(ctx))

    if(ctx.xrpc) router.use(ctx.xrpc.xrpc.router)

    return router
}
