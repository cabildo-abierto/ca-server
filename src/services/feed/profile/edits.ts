

export async function getEditsProfileFeed(userId: string): Promise<{feed?: FeedContentProps[], error?: string}>{
    const edits: FeedContentProps[] = await ctx.db.record.findMany({
        select: {
            ...recordQuery,
            content: {
                select: {
                    topicVersion: {
                        select: {
                            topic: {
                                select: {
                                    id: true,
                                    versions: {
                                        select: {
                                            title: true,
                                            categories: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        where: {
            authorId: userId,
            collection: "ar.com.cabildoabierto.topic"
        }
    })
    return {feed: edits}
}