import {pino} from "pino";


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


export const reactionsQuery = {
    uniqueLikesCount: true,
    uniqueRepostsCount: true,
    _count: {
        select: {
            replies: true
        }
    }
}
