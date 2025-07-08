import type {IncomingMessage, ServerResponse} from "node:http";
import type {AppContext} from "#/index";
import {getIronSession, SessionOptions} from "iron-session";
import express from "express";
import {AtpBaseClient} from "src/lex-api";
import {Agent as BskyAgent} from "@atproto/api";
import {env} from "#/lib/env";

export type Session = { did: string }


export type Agent = SessionAgent | NoSessionAgent


export class BaseAgent {
    ca: AtpBaseClient
    constructor(CAAgent: AtpBaseClient) {
        this.ca = CAAgent
    }
    hasSession(): this is SessionAgent {
        return false
    }
}


export class NoSessionAgent extends BaseAgent {
    bsky: AtpBaseClient
    constructor(CAAgent: AtpBaseClient, bsky: AtpBaseClient) {
        super(CAAgent)
        this.bsky = bsky
    }
}


export class SessionAgent extends BaseAgent {
    bsky: BskyAgent
    did: string
    req?: IncomingMessage
    res?: ServerResponse<IncomingMessage>
    constructor(CAAgent: AtpBaseClient, bskyAgent: BskyAgent, req?: IncomingMessage, res?: ServerResponse<IncomingMessage>) {
        super(CAAgent)
        this.bsky = bskyAgent
        if(!bskyAgent || !bskyAgent.did){
            throw Error("No session.")
        }
        this.did = bskyAgent && bskyAgent.did
        this.req = req
        this.res = res
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
    const CAAgent = new AtpBaseClient(`${env.HOST}:${env.PORT}`)

    const session = await getIronSession<Session>(req, res, cookieOptions)
    if (session.did) {
        try {
            const oauthSession = await ctx.oauthClient.restore(session.did)
            const bskyAgent = new BskyAgent(oauthSession)
            if(oauthSession) {
                return new SessionAgent(CAAgent, bskyAgent, req, res)
            }
        } catch (err) {
            ctx.logger.warn({err}, 'oauth restore failed')
            await session.destroy()
        }
    }
    return new NoSessionAgent(CAAgent, new AtpBaseClient("https://bsky.social"))
}


export const cookieOptions: SessionOptions = {
    cookieName: 'sid',
    password: process.env.COOKIE_SECRET!,
    cookieOptions: {
        sameSite: env.NODE_ENV == "production" ? "none" : "lax",
        httpOnly: true,
        secure: env.NODE_ENV == "production",
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