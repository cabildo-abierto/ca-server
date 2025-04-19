import {getTextFromBlob} from "../topic/topics";


export async function getQuotedContentNoCache({did, rkey}: {did: string, rkey: string}): Promise<QuotedContent> {
    try {
        const q = await ctx.db.record.findMany({
            select: {
                uri: true,
                author: {
                    select: {
                        handle: true,
                        displayName: true
                    }
                },
                content: {
                    select: {
                        text: true,
                        textBlob: {
                            select: {
                                cid: true,
                                authorId: true
                            }
                        },
                        format: true,
                        article: {
                            select: {
                                title: true
                            }
                        },
                        topicVersion: {
                            select: {
                                topic: {
                                    select: {
                                        id: true,
                                        versions: {
                                            select: {
                                                title: true
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
                uri: {
                    in: [getUri(did, "ar.com.cabildoabierto.article", rkey), getUri(did, "ar.com.cabildoabierto.topic",  rkey)]
                }
            }
        })

        if(q[0].content.textBlob != undefined){
            q[0].content.text = await getTextFromBlob(q[0].content.textBlob)
        }

        return q[0]
    } catch (e) {
        console.error("Error getting quoted content", did, rkey)
        console.error(e)
        return null
    }
}


export async function getQuotedContent({did, rkey}: {did: string, rkey: string}): Promise<QuotedContent> {
    return unstable_cache(async () => {
            return await getQuotedContentNoCache({did, rkey})
        }, ["quotedContent:"+did+":"+rkey],
        {
            tags: ["record:"+did+":"+rkey, "quotedContent"],
            revalidate: revalidateEverythingTime
        })()
}