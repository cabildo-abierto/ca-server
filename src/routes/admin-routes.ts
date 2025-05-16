import express from 'express'
import type {AppContext} from '#/index'
import {CAHandler, makeHandler} from "#/utils/handler";
import {updateCategoriesGraphHandler} from "#/services/topic/graph";
import {syncUserHandler} from "#/services/sync/sync-user";
import {updateReferences, updateReferencesHandler} from "#/services/topic/references";
import {deleteCollectionHandler, deleteUserHandler} from "#/services/delete";
import {getAvailableInviteCodes} from "#/services/user/access";
import {updateEngagementCountsHandler} from "#/services/feed/getUserEngagement";


function isAdmin(did: string) {
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

    router.post("/update-references", makeAdminHandler(ctx, updateReferencesHandler))

    router.post(
        "/sync-user/:handleOrDid",
        makeAdminHandler(ctx, syncUserHandler)
    )
    router.post(
        "/delete-user/:handleOrDid",
        makeAdminHandler(ctx, deleteUserHandler)
    )

    router.get(
        "/codes",
        makeAdminHandler(ctx, getAvailableInviteCodes)
    )

    router.post(
        "/update-engagement-counts",
        makeAdminHandler(ctx, updateEngagementCountsHandler)
    )

    router.post(
        "/delete-collection/:collection",
        makeAdminHandler(ctx, deleteCollectionHandler)
    )

    return router
}