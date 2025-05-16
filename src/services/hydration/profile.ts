import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";

export function hydrateProfileViewBasic(did: string, data: Dataplane): CAProfileViewBasic | null {
    const ca = data.caUsers?.get(did)
    const bsky = data.bskyUsers?.get(did)

    if(!bsky) return null

    if(ca) {
        return {
            ...ca,
            viewer: bsky.viewer
        }
    } else if(bsky) {
        return {
            ...bsky,
            $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        }
    } else {
        return null
    }
}