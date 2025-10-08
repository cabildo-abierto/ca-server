import {ProfileViewBasic as CAProfileViewBasic, ProfileView as CAProfileView} from "#/lex-api/types/ar/cabildoabierto/actor/defs.js";
import {Dataplane} from "#/services/hydration/dataplane.js";
import {AppContext} from "#/setup.js";
import {ArCabildoabiertoActorDefs} from "#/lex-api/index.js"
import {EditorStatus} from "@prisma/client";


export function hydrateProfileView(ctx: AppContext, did: string, data: Dataplane): CAProfileView | null {
    const profile = data.profiles?.get(did)
    const viewer = data.profileViewers?.get(did)

    if(profile && viewer) {
        return {
            ...profile,
            viewer,
            $type: "ar.cabildoabierto.actor.defs#profileView"
        }
    }

    const ca = data.caUsers?.get(did)

    if(ca) {
        return {
            did: ca.did,
            handle: ca.handle,
            displayName: ca.displayName ?? undefined,
            createdAt: ca.createdAt.toISOString(),
            avatar: ca.avatar ?? undefined,
            caProfile: ca.caProfile ?? undefined,
            verification: ca.verification ?? undefined,
            editorStatus: ca.editorStatus,
            description: ca.description ?? undefined,
            $type: "ar.cabildoabierto.actor.defs#profileView"
        }
    }


    const caDetailed = data.caUsersDetailed?.get(did)
    const bsky = data.bskyBasicUsers?.get(did)

    if(!bsky) {
        ctx.logger.pino.error({did, bsky: bsky != null, ca: caDetailed != null}, "data not found during profile view basic hydration")
        return null
    }

    return {
        ...bsky,
        caProfile: caDetailed?.caProfile ?? undefined,
        verification: caDetailed?.verification ?? undefined,
        viewer: bsky.viewer,
        $type: "ar.cabildoabierto.actor.defs#profileView"
    }
}


export function hydrateProfileViewBasic(ctx: AppContext, did: string, data: Dataplane): CAProfileViewBasic | null {
    const profile = data.profiles?.get(did)
    const viewer = data.profileViewers?.get(did)

    if(profile && viewer) {
        return {
            ...profile,
            viewer,
            $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
        }
    }

    const caBasic = data.caUsers?.get(did)

    if(caBasic) {
        return {
            did: caBasic.did,
            handle: caBasic.handle,
            displayName: caBasic.displayName ?? undefined,
            createdAt: caBasic.createdAt.toISOString(),
            avatar: caBasic.avatar ?? undefined,
            caProfile: caBasic.caProfile ?? undefined,
            verification: caBasic.verification ?? undefined,
            editorStatus: editorStatusToDisplay(caBasic?.editorStatus),
            viewer: {
                following: caBasic.viewer.following ?? undefined,
                followedBy: caBasic.viewer.followedBy ?? undefined
            },
            $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
        }
    }


    const ca = data.caUsersDetailed?.get(did)
    const bsky = data.bskyBasicUsers?.get(did)

    if(!bsky) {
        ctx.logger.pino.error({did, bsky: bsky != null, ca: ca != null}, "data not found during profile view basic hydration")
        return null
    }

    return {
        ...bsky,
        caProfile: ca?.caProfile ?? undefined,
        verification: ca?.verification ?? undefined,
        editorStatus: editorStatusToDisplay(ca?.editorStatus),
        viewer: bsky.viewer,
        $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
    }
}


function editorStatusToDisplay(status: EditorStatus | undefined) {
    if(status == "Beginner"){
        return "Editor principiante"
    } else if(status == "Editor"){
        return "Editor"
    } else if(status == "Administrator"){
        return "Administrador"
    } else {
        return "Editor principiante"
    }
}


export function hydrateProfileViewDetailed(ctx: AppContext, did: string, dataplane: Dataplane): ArCabildoabiertoActorDefs.ProfileViewDetailed | null {
    const profile = dataplane.profiles?.get(did)
    const viewer = dataplane.profileViewers?.get(did)

    if (!viewer) {
        ctx.logger.pino.error({did}, "viewer data for profile view not found in hydration")
        return null
    }

    if (profile) {
        return {
            ...profile,
            viewer
        }
    }

    const caProfile = dataplane.caUsersDetailed.get(did)
    const bskyProfile = dataplane.bskyDetailedUsers.get(did)

    if (bskyProfile) {
        return {
            ...bskyProfile,
            followersCount: caProfile?.followersCount,
            followsCount: caProfile?.followsCount,
            bskyFollowersCount: bskyProfile.followersCount,
            bskyFollowsCount: bskyProfile.followsCount,
            caProfile: caProfile?.caProfile ?? undefined,
            verification: caProfile?.verification ?? undefined,
            viewer: viewer,
            editorStatus: editorStatusToDisplay(caProfile?.editorStatus),
            editsCount: caProfile?.editsCount ?? 0,
            articlesCount: caProfile?.articlesCount ?? 0,
            $type: "ar.cabildoabierto.actor.defs#profileViewDetailed"
        }
    }

    ctx.logger.pino.error({did, caProfile: caProfile != null, bskyProfile: bskyProfile != null}, "data not found for profile view during hydration")

    return null
}