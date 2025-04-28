import {cleanText} from "#/utils/strings";
import {FeedViewContent} from "#/lex-server/types/ar/cabildoabierto/feed/defs";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";


export async function getFullTopicList(ctx: AppContext){
    const topics: {}[] = await ctx.db.topic.findMany({
        select: {
            id: true,
            popularityScore: true,
            categories: {
                select: {
                    categoryId: true
                }
            },
            lastEdit: true,
            synonyms: true
        },
        where: {
            versions: {
                some: {}
            }
        }
    })
    return topics
}


export async function searchContents(ctx: AppContext, agent: SessionAgent, q: string) : Promise<{feed?: FeedViewContent[], error?: string}> {
    if(q.length == 0) return {feed: []}
    q = cleanText(q)

    // TO DO
    return {feed: []}
    /*let feed: FeedContentProps[] = await ctx.db.record.findMany({
        select: enDiscusionQuery,
        where: {
            collection: {
                in: ["ar.com.cabildoabierto.quotePost", "ar.com.cabildoabierto.article", "app.bsky.feed.post"]
            },
            author: {
                inCA: true
            }
        }
    })

    feed = feed.filter((c: FeedContentProps) => {
        if(c.collection == "app.bsky.feed.post"){
            if(!(c as FastPostProps).content){
                return false
            }
            const text = cleanText((c as FastPostProps).content.text)
            return text.includes(q)
        } else if(c.collection == "ar.com.cabildoabierto.article"){
            const text = cleanText((c as ArticleProps).content.article.title)
            return text.includes(q)
        } else {
            return false
        }
    })

    feed = feed.slice(0, 50)

    const engagement = await getUserEngagement(feed, did)
    feed = addCountersToFeed(feed, engagement)

    return {feed}*/
}