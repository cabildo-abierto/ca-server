import type {IncomingMessage, ServerResponse} from "node:http";
import type {AppContext} from "#/index";
import {getIronSession, SessionOptions} from "iron-session";
import express from "express";
import {AtpBaseClient} from "#/lexicon-api";
import {Agent as BskyAgent} from "@atproto/api";

export type Session = { did: string }


export class Agent {
    ca: AtpBaseClient
    constructor(CAAgent: AtpBaseClient) {
        this.ca = CAAgent
    }
    hasSession(): this is SessionAgent {
        return false
    }
}


export class SessionAgent extends Agent {
    bsky: BskyAgent
    did: string
    constructor(CAAgent: AtpBaseClient, bskyAgent: BskyAgent) {
        super(CAAgent)
        this.bsky = bskyAgent
        if(!bskyAgent || !bskyAgent.did){
            throw Error("No session.")
        }
        this.did = bskyAgent && bskyAgent.did
    }

    override hasSession(): this is SessionAgent {
        return true
    }
}


export async function sessionAgent(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    ctx: AppContext
): Promise<Agent> {
    const CAAgent = new AtpBaseClient("http://127.0.0.1:8080")

    const session = await getIronSession<Session>(req, res, cookieOptions)
    if (session.did) {
        try {
            const oauthSession = await ctx.oauthClient.restore(session.did)
            const bskyAgent = new BskyAgent(oauthSession)
            if(oauthSession) {
                return new SessionAgent(CAAgent, bskyAgent)
            }
        } catch (err) {
            ctx.logger.warn({err}, 'oauth restore failed')
            await session.destroy()
        }
    }

    return new Agent(CAAgent)
}


export const cookieOptions: SessionOptions = {
    cookieName: 'sid',
    password: process.env.COOKIE_SECRET || "",
    cookieOptions: {
        sameSite: "lax",
        httpOnly: true,
        secure: false,
        path: "/"
    }
}


export const handler = (fn: express.Handler) =>
    async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        try {
            await fn(req, res, next)
        } catch (err) {
            next(err)
        }
    }