import {$Typed, AppBskyEmbedRecord} from "@atproto/api";
import {ViewRecord} from "@atproto/api/src/client/types/app/bsky/embed/record";
import {ATProtoStrongRef, Collection, PostCollection} from "#/lib/types";
import {reactionsQuery, recordQuery} from "#/utils/utils";
import {ArticleView, FeedViewContent, PostView} from "#/lexicon-api/types/ar/cabildoabierto/feed/defs";
import {ProfileViewBasic} from "@atproto/api/dist/client/types/app/bsky/actor/defs";
import {getCollectionFromUri, getRkeyFromUri, isArticle, isPost} from "#/utils/uri";
import {SkeletonFeedPost} from "#/lexicon-api/types/app/bsky/feed/defs";
import {FeedSkeleton} from "#/services/feed/feed";
import {addViewerEngagementToFeed} from "#/services/feed/get-user-engagement";
import {Agent, SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {PostView as BskyPostView} from "#/lexicon-api/types/app/bsky/feed/defs"
import {getTextFromBlob} from "#/services/topic/topics";
import {decompress} from "#/utils/compression";
import {getAllText} from "#/services/topic/diff";
import {Record as PostRecord} from "#/lexicon-server/types/app/bsky/feed/post"
import {isReasonRepost} from "#/lexicon-server/types/app/bsky/feed/defs";


type FeedElementQueryResult = {
    uri: string
    cid: string
    rkey: string
    collection: Collection
    createdAt: Date,
    record: string | null
    author: {
        did: string
        handle: string
        displayName: string | null
        avatar: string | null
    }
    _count: {
        likes: number
        reposts: number
        replies: number
    }
    uniqueViewsCount: number | null
    content: {
        text: string | null
        summary?: string
        textBlob: {
            cid: string
        } | null
        format: string | null
        post: {
            quote: string | null
            embed: string | null
            facets: string | null
            replyTo: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
            root: {
                uri: string
                cid: string | null
                author: {
                    did: string
                    handle: string | null
                    displayName: string | null
                }
            } | null
        } | null,
        article: {
            title: string
        } | null
    } | null
    enDiscusion: boolean | null
}


const hydrateFeedQuery = {
    ...recordQuery,
    ...reactionsQuery,
    record: true,
    enDiscusion: true,
    content: {
        select: {
            text: true,
            format: true,
            textBlob: true,
            article: {
                select: {
                    title: true
                }
            },
            post: {
                select: {
                    facets: true,
                    embed: true,
                    quote: true,
                    replyTo: {
                        select: {
                            uri: true,
                            cid: true,
                            author: {
                                select: {
                                    did: true,
                                    handle: true,
                                    displayName: true
                                }
                            }
                        }
                    },
                    root: {
                        select: {
                            uri: true,
                            cid: true,
                            author: {
                                select: {
                                    did: true,
                                    handle: true,
                                    displayName: true
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}


const queryResultToProfileViewBasic = (e: FeedElementQueryResult): ProfileViewBasic => {
    return {
        $type: "app.bsky.actor.defs#profileViewBasic",
        did: e.author.did,
        handle: e.author.handle,
        displayName: e.author.displayName ?? undefined,
        avatar: e.author.avatar ?? undefined,
    }
}


const feedElementQueryResultToArticleView = (e: FeedElementQueryResult): $Typed<ArticleView> => {
    return {
        $type: "ar.cabildoabierto.feed.defs#articleView",
        uri: e.uri,
        cid: e.cid,
        summary: e.content && e.content.summary ? e.content.summary : undefined,
        author: queryResultToProfileViewBasic(e),
        record: e.record ? JSON.parse(e.record) : {},
        indexedAt: e.createdAt.toISOString(),
        likeCount: e._count.likes,
        repostCount: e._count.reposts,
        replyCount: e._count.replies,
        uniqueViewsCount: e.uniqueViewsCount ?? undefined
    }
}


const feedElementQueryResultToPostView = (e: FeedElementQueryResult): $Typed<PostView> => {
    return {
        $type: "ar.cabildoabierto.feed.defs#postView",
        uri: e.uri,
        cid: e.cid,
        author: queryResultToProfileViewBasic(e),
        record: {},
        indexedAt: e.createdAt.toISOString()
    }
}


const feedElementQueryResultToFeedViewContent = (e: FeedElementQueryResult): $Typed<PostView> | $Typed<ArticleView> | null  => {
    if(isArticle(e.collection)){
        return feedElementQueryResultToArticleView(e)
    } else if(isPost(e.collection)){
        return feedElementQueryResultToPostView(e)
    } else {
        throw Error("Translation not implemented.")
    }
}


function joinPostViewAndCAData(uri: string, caMap: Map<string, FeedElementQueryResult>, bskyMap: Map<string, PostView>): $Typed<PostView> | $Typed<ArticleView> | null {
    if(!uri) return null
    const post = bskyMap.get(uri)
    const caData = caMap.get(uri)

    if(!post){
        if(!caData){
            return null
        } else {
            return feedElementQueryResultToFeedViewContent(caData)
        }
    }

    const record = post.record as {
        text: string
        createdAt: string
        facets: any
        embed: any
        $type: PostCollection
        reply?: {parent: ATProtoStrongRef, root?: ATProtoStrongRef}
    }

    if(record.embed && record.embed.$type == "app.bsky.embed.record"){
        record.embed = joinPostViewAndCAData(record.embed.record.uri, caMap, bskyMap)
    }

    const postView: $Typed<PostView> = {
        $type: "ar.cabildoabierto.feed.defs#postView",
        ...post,
        ...(caData ? {
            uniqueViewsCount: caData.uniqueViewsCount ?? undefined,
            likeCount: caData._count.likes,
            repostCount: caData._count.reposts,
        } : {
            uniqueViewsCount: 0,
            likeCount: 0,
            repostCount: 0
        }),
        bskyLikeCount: post.likeCount,
        bskyRepostCount: post.repostCount,
        bskyQuoteCount: post.quoteCount,
        replyCount: post.replyCount
    }
    return postView
}


function hydrateFeedElement(e: SkeletonFeedPost, caMap: Map<string, FeedElementQueryResult>, bskyMap: Map<string, PostView>): FeedViewContent | null {
    const reason = e.reason

    const childBsky = bskyMap.get(e.post)
    if(!childBsky) return null
    const childRecord = childBsky.record as PostRecord

    const leaf = joinPostViewAndCAData(e.post, caMap, bskyMap)
    const parent = childRecord.reply && isReasonRepost(reason) ? joinPostViewAndCAData(childRecord.reply.parent.uri, caMap, bskyMap) : null
    const root = childRecord.reply && isReasonRepost(reason) ? joinPostViewAndCAData(childRecord.reply.root.uri, caMap, bskyMap) : null

    if(!leaf) return null

    if(!parent){
        return {content: leaf, reason}
    } else if(parent && root) {
        return {
            content: leaf,
            reason,
            reply: {
                parent: parent,
                root: root // puede ser igual a parent, el frontend se ocupa
            }
        }
    } else {
        return null // no debería pasar
    }

    /*
    const last = joinPostViewAndCAData(e.lastInThreadId, caMap, bskyMap)
    const secondToLast = joinPostViewAndCAData(e.secondToLastInThreadId, caMap, bskyMap)

    if(!root){
        return null
    } else if(!last){
        return {...root, reason}
    } else if(!secondToLast) {
        if(last.content.$type == "app.bsky.feed.defs#postView" || last.content.$type == "ar.cabildoabierto.feed#postView"){
            let r = {...last}
            r.content.post.replyTo = root
            return {...r, reason}
        } else {
            throw Error("Se intentó mostrar una respuesta que no es un post.")
        }
    } else {
        if(last.collection == "app.bsky.feed.post" || last.collection == "ar.com.cabildoabierto.quotePost"){
            let r = {...last}
            r.content.post.root = root
            r.content.post.replyTo = secondToLast
            return {...r, reason}
        } else {
            throw Error("Se intentó mostrar una respuesta que no es un post.")
        }
    }
     */
}


export const bskyPostViewToCAPostView = (p: BskyPostView): PostView  => {
    return {
        ...p,
        $type: "ar.cabildoabierto.feed.defs#postView",
    }
}


export async function getBskyPosts(agent: SessionAgent, uris: string[]): Promise<PostView[]> {
    const postsList = uris.filter(uri => (getCollectionFromUri(uri) == "app.bsky.feed.post"))

    if(postsList.length == 0){
        return []
    } else {
        const batches: string[][] = []
        for(let i = 0; i < postsList.length; i+= 25){
            batches.push(postsList.slice(i, i + 25))
        }
        const results = await Promise.all(batches.map(b => agent.bsky.getPosts({uris: b})))
        return results.map(r => r.data.posts).reduce((acc, cur) => [...acc, ...cur]).map(bskyPostViewToCAPostView)
    }
}


export async function getCAFeedContents(ctx: AppContext, uris: string[]): Promise<FeedElementQueryResult[]> {
    const res = await ctx.db.record.findMany({
        select: {
            ...hydrateFeedQuery,
        },
        where: {
            uri: {
                in: uris
            }
        }
    })

    let contents: FeedElementQueryResult[] = []
    res.forEach(r => {
        if(r.cid && r.author.handle){
            contents.push({
                ...r,
                cid: r.cid,
                author: {
                    ...r.author,
                    handle: r.author.handle
                },
                collection: r.collection as Collection,
            })
        }
    })
    return contents
}


function addEmbedsToPostsMap(m: Map<string, PostView>){
    const posts = Array.from(m.values())

    posts.forEach(post => {
        if(post.embed && post.embed.$type == "app.bsky.embed.record#view"){
            const embed = post.embed as AppBskyEmbedRecord.View
            if(embed.record.$type == "app.bsky.embed.record#viewRecord"){
                const record = embed.record as ViewRecord
                m.set(record.uri, {
                    ...record,
                    uri: record.uri,
                    cid: record.cid,
                    $type: "ar.cabildoabierto.feed.defs#postView",
                    author: {
                        ...record.author
                    },
                    indexedAt: record.indexedAt,
                    record: record.value
                })
            }
        }
    })

    return m
}


function markdownToPlainText(md: string){
    return md // TO DO: Transformar a editor state y luego a plain text
}


const addArticleSummaries = async (m: Map<string, FeedElementQueryResult>) => {
    const keys = Array.from(m.keys())
    for(let i = 0; i < keys.length; i++) {
        const val = m.get(keys[i])
        if(val && isArticle(val.collection) && val.content && val.content.textBlob){
            const blob = val.content.textBlob
            const text = await getTextFromBlob({cid: blob.cid, authorId: val.author.did})
            if(text){
                const format = val.content.format
                let summary = ""
                if(format == "markdown"){
                    summary = markdownToPlainText(text).slice(0, 150)
                } else if(!format || format == "lexical-compressed"){
                    const summaryJson = JSON.parse(decompress(text))
                    summary = getAllText(summaryJson.root).slice(0, 150)
                }
                val.content.summary = summary
                m.set(keys[i], val)
            }
        }
    }
}


export async function hydrateFeed(ctx: AppContext, agent: SessionAgent, skeleton: FeedSkeleton){
    const uris = skeleton.map(p => p.post)

    const bskyPosts = await getBskyPosts(agent, uris)

    const replyUris = bskyPosts.reduce((acc: string[], cur) => {
        const record = cur.record as PostRecord
        if(record.reply){
            return [...acc, cur.uri, record.reply.root.uri, record.reply.parent.uri]
        } else {
            return [...acc, cur.uri]
        }
    }, [])

    const [bskyReplies, caContents] = await Promise.all([getBskyPosts(agent, replyUris), getCAFeedContents(ctx, uris)])

    let bskyPostsMap = new Map([...bskyPosts, ...bskyReplies].map(item => [item.uri, item]))
    bskyPostsMap = addEmbedsToPostsMap(bskyPostsMap)

    const caContentsMap = new Map(caContents.map(item => [item.uri, item]))
    await addArticleSummaries(caContentsMap)

    const hydrated = skeleton.map((e) => (hydrateFeedElement(e, caContentsMap, bskyPostsMap))).filter(x => x != null)

    return await addViewerEngagementToFeed(ctx, agent.did, hydrated)
}