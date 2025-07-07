import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";

export function hydrateProfileViewBasic(did: string, data: Dataplane): CAProfileViewBasic | null {
    const ca = data.caUsers?.get(did)
    const bsky = data.bskyUsers?.get(did)

    if(!bsky) return null

    if(bsky) {
        if(ca){
            return {
                ...bsky,
                caProfile: ca.caProfile,
                verification: ca.verification,
                viewer: bsky.viewer,
                $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
            }
        } else {
            return {
                ...bsky,
                verification: undefined,
                viewer: bsky.viewer,
                $type: "ar.cabildoabierto.actor.defs#profileViewBasic"
            }
        }
    } else if(ca) {
        return {
            ...ca,
            $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        }
    } else {
        return null
    }
}