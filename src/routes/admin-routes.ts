import express from 'express'
import type {AppContext} from '#/index'
import {CAHandler, makeHandler} from "#/utils/handler";


function isAdmin(did: string){
    return [
        "did:plc:2356xofv4ntrbu42xeilxjnb",
        "did:plc:rup47j6oesjlf44wx4fizu4m",
        "did:plc:2dbz7h5m3iowpqc23ozltpje"
    ].includes(did)
}


function makeAdminHandler<P, Q>(ctx: AppContext, handler: CAHandler<P, Q>) {

    const adminHandler: CAHandler<P, Q> = async (ctx, agent, params) => {
        if(isAdmin(agent.did)){
            return handler(ctx, agent, params)
        } else {
            return {error: "Necesitás permisos de administrador para realizar esta acción."}
        }
    }

    return makeHandler(ctx, adminHandler)
}


export const adminRoutes = (ctx: AppContext) => {
    const router = express.Router()

    router.post("/one-time", makeAdminHandler(ctx, oneTime))

    return router
}


const oneTime: CAHandler<{}, {}> = async (ctx, agent, params) => {

    return {data: {}}
}