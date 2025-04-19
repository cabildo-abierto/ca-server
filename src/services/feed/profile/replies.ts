

export async function getRepliesProfileFeedSkeletonBsky(did: string): Promise<FeedSkeleton> {
    const {agent} = await getSessionAgent()
    const feed = await agent.getAuthorFeed({actor: did, filter: "posts_with_replies"})

    return removeRepeatedInSkeleton(feed.data.feed.filter(filterTimeline).map(skeletonElementFromFeedViewPost))
}


export async function getRepliesProfileFeedSkeletonCA(did: string): Promise<FeedSkeleton> {
    return await ctx.db.record.findMany({
        select: {
            uri: true,
            lastInThreadId: true,
            secondToLastInThreadId: true
        },
        where: {
            authorId: did,
            collection: "ar.com.cabildoabierto.article"
        }
    })

    // to do: respuestas y quote posts a artículos
}


export async function getRepliesProfileFeedSkeleton(did: string): Promise<FeedSkeleton> {
    return concat(await Promise.all([
        getRepliesProfileFeedSkeletonBsky(did),
        getRepliesProfileFeedSkeletonCA(did)
    ]))
}


export async function getRepliesProfileFeed(did: string): Promise<{feed?: FeedContentProps[], error?: string}>{
    return await getFeed({
        getSkeleton: async () => {return await getRepliesProfileFeedSkeleton(did)},
        sortKey: rootCreationDateSortKey
    })
}