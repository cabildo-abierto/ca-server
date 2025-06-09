import {Prisma} from ".prisma/client";
import SortOrder = Prisma.SortOrder;


export const authorQuery = {
    author: {
        select: {
            did: true,
            handle: true,
            displayName: true,
            avatar: true,
            CAProfileUri: true
        }
    }
}


export const recordQuery = {
    uri: true,
    cid: true,
    rkey: true,
    collection: true,
    createdAt: true,
    record: true,
    ...authorQuery
}


export const visualizationQuery = {
    select: {
        spec: true,
        dataset: {
            select: {
                uri: true,
                dataset: {
                    select: {
                        title: true
                    }
                }
            }
        },
        previewBlobCid: true
    }
}


export const datasetQuery = {
    select: {
        title: true,
        columns: true,
        description: true,
        dataBlocks: {
            select: {
                format: true,
                blob: {
                    select: {
                        cid: true,
                        authorId: true
                    }
                }
            },
            orderBy: {
                record: {
                    createdAt: "asc" as SortOrder
                }
            }
        }
    }
}


export const reactionsQuery = {
    uniqueLikesCount: true,
    uniqueRepostsCount: true,
    _count: {
        select: {
            replies: true
        }
    }
}


export const enDiscusionQuery = {
    ...recordQuery,
    ...reactionsQuery,
    content: {
        select: {
            text: true,
            format: true,
            textBlob: true,
            selfLabels: true,
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
    },
}


export const threadQuery = (c: string) => {
    if(c == "app.bsky.feed.post" || c == "ar.com.cabildoabierto.quotePost"){

    } else if(c == "ar.com.cabildoabierto.article"){
        return
    } else if(c == "ar.com.cabildoabierto.visualization"){
        return {
            ...recordQuery,
            ...reactionsQuery,
            visualization: visualizationQuery,
        }
    } else if(c == "ar.com.cabildoabierto.dataset"){
        return {
            ...recordQuery,
            ...reactionsQuery,
            dataset: datasetQuery,
        }

    } else {
        throw Error("Not implemented")
    }
}


export function getObjectSizeInBytes(obj: any) {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
}


export function logTimes(s: string, times: number[]){
    const diffs: number[] = []
    for(let i = 1; i < times.length; i++){
        diffs.push(times[i]-times[i-1])
    }
    const sum = diffs.join(" + ")
    console.log(s, times[times.length-1]-times[0], "=", sum)
}
