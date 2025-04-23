import {AppContext} from "#/index";
import {FeedViewContent} from "#/lex-api/types/ar/cabildoabierto/feed/defs";
import {FeedEngagementProps} from "#/lib/types";


export async function getUserEngagement(ctx: AppContext, uris: string[], did: string): Promise<FeedEngagementProps> {

    const getLikes = ctx.db.like.findMany({
        select: {
            likedRecordId: true,
            uri: true
        },
        where: {
            record: {
                authorId: did
            },
            likedRecordId: {
                in: uris
            }
        }
    })

    const getReposts = ctx.db.repost.findMany({
        select: {
            repostedRecordId: true,
            uri: true
        },
        where: {
            record: {
                authorId: did
            },
            repostedRecordId: {
                in: uris
            }
        }
    })

    const [likes, reposts] = await Promise.all([getLikes, getReposts])

    return {likes, reposts}
}


export function addViewer(elem: any, engagement: FeedEngagementProps): any {
    if(elem.content && elem.content.post){
        if(elem.content.post.replyTo && elem.content.post.replyTo._count != undefined){
            elem.content.post.replyTo = addViewer(elem.content.post.replyTo, engagement)
        }
        if(elem.content.post.root && elem.content.post.root._count != undefined){
            elem.content.post.root = addViewer(elem.content.post.root, engagement)
        }
    }

    let like: string | undefined
    let repost: string | undefined

    engagement.likes.forEach(l => {
        if(l.likedRecordId == elem.uri){
            like = l.uri
        }
    })
    engagement.reposts.forEach(l => {
        if(l.repostedRecordId == elem.uri){
            repost = l.uri
        }
    })

    const viewer = {repost, like}

    return {
        ...elem,
        viewer
    }
}


export function addViewerToFeed(feed: any[], engagement: FeedEngagementProps): FeedViewContent[] {
    return feed.map((elem) => {
        return addViewer(elem, engagement)
    })
}


export async function addViewerEngagementToFeed(ctx: AppContext, viewerDid: string, feed: FeedViewContent[]) {
    const uris = feed.map(e => ("uri" in e.content ? e.content.uri : null)).filter(x => x != null)
    const engagement = await getUserEngagement(ctx, uris, viewerDid)

    return addViewerToFeed(feed, engagement)
}