import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {Dataplane} from "#/services/hydration/dataplane";

export function hydrateProfileViewBasic(did: string, data: Dataplane): CAProfileViewBasic | null {
    const ca = data.data.caUsers?.get(did)
    const bsky = data.data.bskyUsers?.get(did)

    if(ca) {
        return ca
    } else if(bsky) {
        return {
            ...bsky,
            $type: "ar.cabildoabierto.actor.defs#profileViewBasic",
        }
    } else {
        return null
    }
}