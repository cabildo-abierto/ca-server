import {HydrationData} from "#/services/hydration/hydrate";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";

export function hydrateProfileViewBasic(did: string, data: HydrationData): CAProfileViewBasic | null {
    const ca = data.caUsers?.get(did)
    const bsky = data.bskyUsers?.get(did)

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