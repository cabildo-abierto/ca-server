import {getDidFromUri, getRkeyFromUri} from "#/utils/uri";
import {AppContext} from "#/setup";


export function createRecord({ctx, uri, cid, createdAt, collection}: {
    ctx: AppContext,
    uri: string
    cid: string
    createdAt: Date
    collection: string
}){
    const data = {
        uri,
        cid,
        rkey: getRkeyFromUri(uri),
        createdAt: new Date(createdAt),
        authorId: getDidFromUri(uri),
        collection: collection
    }

    let updates: any[] = [ctx.db.record.upsert({
        create: data,
        update: data,
        where: {
            uri: uri
        }
    })]
    return updates
}
