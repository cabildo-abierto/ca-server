import express from 'express'
import type {AppContext} from '#/index'
import {cookieOptions, sessionAgent, handler, Session} from "#/utils/session-agent";
import {getIronSession} from "iron-session";
import {Prisma} from "@prisma/client";
import {getUserById} from "#/services/user/users";

const router = express.Router()


const fullUserQuery = {
    did: true,
    handle: true,
    avatar: true,
    banner: true,
    displayName: true,
    description: true,
    email: true,
    createdAt: true,
    hasAccess: true,
    inCA: true,
    platformAdmin: true,
    editorStatus: true,
    seenTutorial: true,
    usedInviteCode: {
        select: {
            code: true
        }
    },
    subscriptionsUsed: {
        orderBy: {
            createdAt: "asc" as Prisma.SortOrder
        }
    },
    subscriptionsBought: {
        select: {
            id: true,
            price: true
        },
        where: {
            price: {
                gte: 500
            }
        }
    },
    records: {
        select: {
            cid: true,
            follow: {
                select: {
                    userFollowedId: true
                }
            }
        },
        where: {
            collection: "app.bsky.graph.follow",
            follow: {
                userFollowed: {
                    inCA: true
                }
            }
        }
    },
    followers: {
        select: {
            uri: true,
            record: {
                select: {
                    authorId: true
                }
            }
        }
    },
    messagesReceived: {
        select: {
            createdAt: true,
            id: true,
            text: true,
            fromUserId: true,
            toUserId: true,
            seen: true
        }
    },
    messagesSent: {
        select: {
            createdAt: true,
            id: true,
            text: true,
            fromUserId: true,
            toUserId: true,
            seen: true
        }
    }
}




export default function userRoutes(ctx: AppContext) {
    router.get(
        '/user/:did?',
        handler(async (req, res) => {
            let {did} = req.params

            if(!did){
                const agent = await sessionAgent(req, res, ctx)
                if(!agent.hasSession()){
                    return res.status(200).json({error: "No session"})
                } else {
                    did = agent.did
                }
            }

            const user = await getUserById(ctx, did)
            return res.json({user})
        })
    )

    return router
}
