import {setupAppContext} from "#/setup"
import {
    getReferencesToInsert, recreateAllReferences
} from "./services/wiki/references/references";


async function run() {
    const {ctx} = await setupAppContext([])

    //const uris = ["at://did:plc:u325utpfhcdeekqzlbyhidhw/ar.cabildoabierto.feed.article/3lukyhxzxot2l"]
    //const uris = ["at://did:plc:mymz5u2wmmmxdtsdqjqyv3x3/ar.cabildoabierto.feed.article/3lwr7etijeq2a"]
    //const topics = ["Educación"]

    //const refs = await getReferencesToInsert(ctx, uris, topics)

    //ctx.logger.pino.info({refs}, "refs")
    //await recreateAllReferences(ctx, new Date(0))
    //await recomputeTopicInteractionsAndPopularities(ctx, new Date(0))
}

run()