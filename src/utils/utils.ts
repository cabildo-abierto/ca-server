

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
            replies: true,
            quotes: true,
        }
    }
}


export function logTimes(s: string, times: number[]){
    const diffs: number[] = []
    for(let i = 1; i < times.length; i++){
        diffs.push(times[i]-times[i-1])
    }
    const sum = diffs.join(" + ")
    console.log(s, times[times.length-1]-times[0], "=", sum)
}
