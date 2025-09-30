import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";
import {AppContext} from "#/setup";
import {ArCabildoabiertoActorDefs} from "#/lex-api"

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

    const ca = data.caUsers?.get(did)
    const bsky = data.bskyBasicUsers?.get(did)

    if(!bsky) {
        ctx.logger.pino.error({did, bsky: bsky != null, ca: ca != null}, "data not found during profile view basic hydration")
        return null
    }

    return {
        ...bsky,
        caProfile: ca?.caProfile,
        verification: ca?.verification ?? undefined,
        viewer: bsky.viewer,
        $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
    }
}

export function hydrateProfileView(ctx: AppContext, did: string, dataplane: Dataplane): ArCabildoabiertoActorDefs.ProfileViewDetailed | null {
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

    const caProfile = dataplane.caUsers.get(did)
    const bskyProfile = dataplane.bskyDetailedUsers.get(did)

    if (bskyProfile) {
        return {
            ...bskyProfile,
            followersCount: caProfile?.followersCount,
            followsCount: caProfile?.followsCount,
            bskyFollowersCount: bskyProfile.followersCount,
            bskyFollowsCount: bskyProfile.followsCount,
            caProfile: caProfile?.caProfile,
            verification: caProfile?.verification ?? undefined,
            viewer: viewer,
            $type: "ar.cabildoabierto.actor.defs#profileViewDetailed"
        }
    }

    ctx.logger.pino.error({did, caProfile: caProfile != null, bskyProfile: bskyProfile != null}, "data not found for profile view during hydration")

    return null
}