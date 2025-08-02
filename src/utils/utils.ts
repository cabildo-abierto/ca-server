import {Prisma} from ".prisma/client";
import SortOrder = Prisma.SortOrder;


export const authorQuery = {
    author: {
        select: {
            did: true,
            handle: true,
            displayName: true,
            avatar: true,
            CAProfileUri: true,
            userValidationHash: true,
            orgValidation: true
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


export function logTimes(s: string, times: number[]){
    return
    /*const diffs: number[] = []
    for(let i = 1; i < times.length; i++){
        diffs.push(times[i]-times[i-1])
    }
    const sum = diffs.join(" + ")
    console.log(s, times[times.length-1]-times[0], "=", sum)*/
}
