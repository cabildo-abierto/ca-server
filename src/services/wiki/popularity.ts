import {gett, unique} from "#/utils/arrays";
import {AppContext} from "#/index";
import {getDidFromUri} from "#/utils/uri";
import {CAHandler} from "#/utils/handler";


type ContentInteractions = {
    uri: string
    replies: {
        uri: string
    }[]
    reactions: {
        uri: string
    }[]
}

function getAllContentInteractions(uri: string,
                                   m: Map<string, ContentInteractions>,
                                   immediateInteractions: Map<string, Set<string>>
){
    const c = gett(m, uri)
    const s = gett(immediateInteractions, uri)

    c.replies.forEach((r) => {
        const rInteractions = getAllContentInteractions(r.uri, m, immediateInteractions)
        rInteractions.forEach((i) => {s.add(i)})
    })

    return s
}


function countTopicInteractions(topic: {
    id: string
    referencedBy: {referencingContentId: string}[], versions: {uri: string}[]}, contentInteractions: Map<string, Set<string>>,
    humanUsers: Set<string>
){
    let s: string[] = []

    try {

        topic.referencedBy.forEach(({referencingContentId}) => {
            const cInteractions = contentInteractions.get(referencingContentId)

            if(cInteractions){
                cInteractions.forEach((did) => {
                    s.push(did)
                })
            }
        })

        topic.versions.forEach((v) => {
            const cInteractions = contentInteractions.get(v.uri)

            if(cInteractions){
                cInteractions.forEach((did) => {
                    s.push(did)
                })
            }
        })

        s = unique(s).filter(x => humanUsers.has(x))

        return s.length
    } catch (error) {
        console.log(error)
        throw error
    }
}


export async function computeTopicsPopularityScore(ctx: AppContext): Promise<{
    id: string, score: number}[]>{
    const contentInteractionsPromise = getContentInteractions(ctx)
    const topicsPromise = ctx.db.topic.findMany({
        select: {
            id: true,
            referencedBy: {
                select: {
                    referencingContentId: true
                }
            },
            versions: {
                select: {
                    uri: true
                }
            }
        }
    })

    const [contentInteractions, topics] = await Promise.all([contentInteractionsPromise, topicsPromise])

    console.log("got", contentInteractions.length, "content interactions and topics", topics.length)

    const contentInteractionsMap: Map<string, Set<string>> = new Map(contentInteractions.map(({uri, interactions}) => ([
        uri, new Set(interactions)
    ])))

    console.log("counting interactions")
    const res = (await ctx.db.user.findMany({
        select: {
            did: true,
            handle: true
        },
        where: {
            /*userValidationHash: { // Cuando la validación empiece a ser obligatoria
                not: null
            }*/
            orgValidation: null
        }
    }))
    const humanUsers = new Set(res.map(u => u.did))
    console.log("non human users", res.map(u => u.handle ?? u.did))

    const topicScores = new Map<string, number>()
    for(let i = 0; i < topics.length; i++){
        const score = countTopicInteractions(topics[i], contentInteractionsMap, humanUsers)
        topicScores.set(topics[i].id, score)
    }

    console.log("returning scores")

    return Array.from(topicScores.entries()).map(([id, score]) => {
        return {id, score}
    })
}


export async function getContentInteractions(ctx: AppContext) : Promise<{uri: string, interactions: string[]}[]> {
    const contents: ContentInteractions[] = await ctx.db.record.findMany({
        select: {
            uri: true,
            replies: {
                select: {
                    uri: true
                }
            },
            reactions: {
                select: {
                    uri: true
                }
            }
        },
        where: {
            collection: {
                in: [
                    "ar.com.cabildoabierto.quotePost",
                    "ar.com.cabildoabierto.article",
                    "ar.com.cabildoabierto.post",
                    "app.bsky.feed.post",
                    "ar.com.cabildoabierto.topic"
                ]
            }
        }
    })
    const m = new Map<string, ContentInteractions>()

    const immediateInteractions = new Map<string, Set<string>>()
    for(let i = 0; i < contents.length; i++) {

        const s = new Set<string>()
        const c = contents[i]
        const author = getDidFromUri(c.uri)
        s.add(author)

        c.reactions.forEach(({uri}) => {
            const did = getDidFromUri(uri)
            s.add(did)
        })

        c.replies.forEach(({uri}) => {
            const did = getDidFromUri(uri)
            s.add(did)
        })

        immediateInteractions.set(c.uri, s)
        m.set(c.uri, contents[i])
    }

    const totalInteractions = new Map<string, Set<string>>()
    for(let i = 0; i < contents.length; i++) {
        const c = contents[i]
        const s = getAllContentInteractions(c.uri, m, immediateInteractions)
        totalInteractions.set(c.uri, s)
    }

    let r: {uri: string, interactions: string[]}[] = []
    totalInteractions.forEach((v, k) => {
        r.push({uri: k, interactions: Array.from(v)})
    })
    return r
}


export async function updateTopicPopularityScores(ctx: AppContext) {
    console.log("getting scores")
    const scores: { id: string, score: number }[] = (await computeTopicsPopularityScore(ctx)).map(
        ({ id, score }) => ({
            id: id,
            score: score
        })
    )

    console.log("got", scores.length, "scores")

    const t1 = Date.now();

    const values = scores.map(s => ({
        id: s.id,
        popularityScore: s.score
    }))

    await ctx.kysely
        .insertInto("Topic")
        .values(values)
        .onConflict((oc) => oc.column("id").doUpdateSet({
            popularityScore: eb => eb.ref("excluded.popularityScore")
        }))
        .execute()

    console.log("done after", Date.now() - t1);
}