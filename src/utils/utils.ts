import type {IncomingMessage, ServerResponse} from "node:http";
import type {AppContext} from "#/index";
import {getIronSession, SessionOptions} from "iron-session";
import express from "express";
import {AtpBaseClient} from "#/lexicon-api";

export type Session = { did: string }

export async function getSessionAgent(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    ctx: AppContext
) {
    const session = await getIronSession<Session>(req, res, cookieOptions)
    if (!session.did) return null
    try {
        const oauthSession = await ctx.oauthClient.restore(session.did)
        const agent = new AtpBaseClient("http://127.0.0.1:8080")
        return oauthSession ? agent : null
    } catch (err) {
        ctx.logger.warn({err}, 'oauth restore failed')
        //await session.destroy()
        return null
    }
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


// Helper function for defining routes
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