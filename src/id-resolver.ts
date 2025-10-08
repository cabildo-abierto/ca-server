import {IdResolver, MemoryCache} from '@atproto/identity'
import {type Redis} from "ioredis";

const HOUR = 60e3 * 60
const DAY = HOUR * 24


export function createIdResolver() {
    return new IdResolver({
        didCache: new MemoryCache(HOUR, DAY),
    })
}

export interface BidirectionalResolver {
    resolveHandleToDid(handle: string): Promise<string | null>

    resolveDidToHandle(did: string): Promise<string>

    resolveDidsToHandles(dids: string[]): Promise<Record<string, string>>
}

export function createBidirectionalResolver(resolver: IdResolver, ioredis: Redis) {
    return {
        async resolveDidToHandle(did: string): Promise<string> {
            const handle = await ioredis.get(`did-handle:${did}`)
            if(!handle){
                const didDoc = await resolver.did.resolveAtprotoData(did)
                const resolvedHandle = await resolver.handle.resolve(didDoc.handle)
                if (resolvedHandle === did) {
                    await ioredis.set(`did-handle:${did}`, didDoc.handle, 'EX', 3600)
                    return didDoc.handle
                }
            } else {
                return handle
            }
            return did
        },

        async resolveDidsToHandles(
            dids: string[]
        ): Promise<Record<string, string>> {
            const didHandleMap: Record<string, string> = {}
            const resolves = await Promise.all(
                dids.map((did) => this.resolveDidToHandle(did).catch((_) => did))
            )
            for (let i = 0; i < dids.length; i++) {
                didHandleMap[dids[i]] = resolves[i]
            }
            return didHandleMap
        },

        async resolveHandleToDid(handle: string): Promise<string | null> {
            let did: string | null | undefined = await ioredis.get(`handle-did:${handle}`)
            if(!did){
                did = await resolver.handle.resolveDns(handle)
                if(!did){
                    did = await resolver.handle.resolveHttp(handle)
                }
                if(did){
                    await ioredis.set(`handle-did:${handle}`, did, 'EX', 3600)
                }
            } else {
                return did
            }
            return did ?? null
        }
    }
}
