import express from 'express'
import type {AppContext} from '#/index'
import {CAHandler, makeHandler} from "#/utils/handler";
import {updateCategoriesGraphHandler} from "#/services/topic/graph";
import {syncUserHandler} from "#/services/sync/sync-user";


function isAdmin(did: string){
    return [
        "did:plc:2356xofv4ntrbu42xeilxjnb",
        "did:plc:rup47j6oesjlf44wx4fizu4m",
        "did:plc:2dbz7h5m3iowpqc23ozltpje"
    ].includes(did)
}


function makeAdminHandler<P, Q>(ctx: AppContext, handler: CAHandler<P, Q>): express.Handler {

    const adminOnlyHandler: CAHandler<P, Q> = async (ctx, agent, params) => {
        if (isAdmin(agent.did)) {
            return handler(ctx, agent, params)
        } else {
            return {error: "Necesitás permisos de administrador para realizar esta acción."}
        }
    }

    return makeHandler(ctx, adminOnlyHandler)
}


export const adminRoutes = (ctx: AppContext) => {
    const router = express.Router()

    router.post("/update-categories-graph", makeAdminHandler(ctx, updateCategoriesGraphHandler))

    router.post(
        "/sync-user/:handleOrDid",
        makeAdminHandler(ctx, syncUserHandler)
    )

    return router
}