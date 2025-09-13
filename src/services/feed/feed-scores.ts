import {AppContext} from "#/setup";
import {sql} from "kysely";
import {logTimes} from "#/utils/utils";


export async function updateInteractionsScore(ctx: AppContext, uris?: string[]) {
    if(uris && uris.length == 0) return
    const batchSize = 500
    let offset = 0
    const lastMonth = new Date(Date.now() - 1000*3600*24*30)
    while(true){
        const t1 = Date.now()

        let batchUris: string[] | null = null
        if(uris != null){
            batchUris = uris.slice(offset, offset+batchSize)
        }
        console.log("getting interactions scores for batch", offset, batchSize, "with total", uris?.length)

        const scores = await ctx.kysely
            .selectFrom("Content")
            .innerJoin("Record", "Record.uri", "Content.uri")
            .select(eb => [
                "Content.uri",
                eb(
                    "Record.uniqueLikesCount",
                    "-",
                    eb.case()
                        .when(
                            eb.exists(eb.selectFrom('Reaction')
                                .leftJoin('Record as ReactionRecord', 'Reaction.uri', 'ReactionRecord.uri')
                                .whereRef("Reaction.subjectId", "=", "Record.uri")
                                .where('ReactionRecord.collection', '=', 'app.bsky.feed.like')
                                .whereRef('ReactionRecord.authorId', '=', 'Record.authorId'))
                        )
                        .then(1).else(0)
                        .end()
                ).as("likesScore"),
                sql<number>`
                    "Record"."uniqueLikesCount" + 
                    "Record"."uniqueRepostsCount" +
                    (select count("Post"."uri") as "count" from "Post"
                    inner join "Record" as "ReplyRecord" on "Post"."uri" = "ReplyRecord"."uri"
                    where 
                        "Post"."replyToId" = "Record"."uri" and
                        "ReplyRecord"."authorId" != "Record"."authorId"
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on 
                                "Reaction"."uri" = "ReactionRecord"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.repost'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"
                                 and "Reaction"."subjectId" = "Record"."uri"
                        ) then 1 else 0 end
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on 
                                "Reaction"."uri" = "ReactionRecord"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.like'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"  
                                 and "Reaction"."subjectId" = "Record"."uri"  
                        ) then 1 else 0 end
                    )
                `.as("interactionsScore"),
                sql<number>`
                    ("Record"."uniqueLikesCount" + 
                    "Record"."uniqueRepostsCount" +
                    (select count("Post"."uri") as "count" from "Post"
                    inner join "Record" as "ReplyRecord" on "Post"."uri" = "ReplyRecord"."uri"
                    where 
                        "Post"."replyToId" = "Record"."uri" and
                        "ReplyRecord"."authorId" != "Record"."authorId"
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on 
                                    "Reaction"."uri" = "ReactionRecord"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.repost'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"
                                 and "Reaction"."subjectId" = "Record"."uri"  
                        ) then 1 else 0 end
                    )
                    - (
                        case when exists (
                            select * from "Reaction"
                            inner join "Record" as "ReactionRecord" on 
                                "Reaction"."uri" = "ReactionRecord"."uri"
                            where
                                "ReactionRecord"."collection" = 'app.bsky.feed.like'
                                 and "ReactionRecord"."authorId" = "Record"."authorId"
                                 and "Reaction"."subjectId" = "Record"."uri"    
                        ) then 1 else 0 end
                    ))::numeric / sqrt(1 + (
                        select count(distinct "Follower"."did") from "Follow"
                        inner join "Record" as "FollowRecord" on "Follow"."uri" = "FollowRecord"."uri"
                        inner join "User" as "Follower" on "FollowRecord"."authorId" = "Follower"."did"
                        where "Follower"."inCA" = true
                        and "Follow"."userFollowedId" = "Record"."authorId"
                    ))
                `.as("relativePopularityScore"),
                "Record.created_at"
            ])
            .where("Record.created_at", ">", lastMonth)
            .$if(batchUris != null, qb => qb.where("Content.uri", "in", batchUris))
            .$if(batchUris == null, qb => qb.limit(batchSize).offset(offset))
            .execute()

        const t2 = Date.now()

        console.log(`inserting ${scores.length} scores`)

        if(scores.length > 0){
            await ctx.kysely
                .insertInto("Content")
                .values(scores.map(s => ({
                    ...s,
                    embeds: [],
                    selfLabels: []
                })))
                .onConflict(oc => oc.column("uri").doUpdateSet(eb => ({
                    likesScore: eb.ref("excluded.likesScore"),
                    interactionsScore: eb.ref("excluded.interactionsScore"),
                    relativePopularityScore: eb.ref("excluded.relativePopularityScore"),
                    created_at: eb.ref("excluded.created_at")
                })))
                .execute()
        }

        const t3 = Date.now()
        logTimes(`update interaction scores for batch ${offset} with size ${scores.length} (total=${uris?.length})`, [t1, t2, t3])
        offset += batchSize
        if(scores.length < batchSize) break
    }
}