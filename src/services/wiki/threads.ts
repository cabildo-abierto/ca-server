import {AppContext} from "#/setup";



export async function updateThreads(ctx: AppContext) {
    const batchSize = 10000
    let curOffset = 0

    let edges: {uri: string, replyToId: string}[] = []

    while(true){
        const res = await ctx.kysely
            .selectFrom("Post")
            .innerJoin("Record", "Record.uri", "Post.uri")
            .select(["Post.uri", "Post.replyToId"])
            .where("Post.replyToId", "is not", null)
            .orderBy("Record.lastUpdatedAt", "asc")
            .limit(batchSize)
            .offset(curOffset)
            .execute()
        if(res.length < batchSize){
            break
        }
        curOffset += batchSize
        res.forEach(r => {
            if(r.replyToId) edges.push({uri: r.uri, replyToId: r.replyToId})
        })
    }
}