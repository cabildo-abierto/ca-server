import {AppContext} from "#/index";
import {CAHandler} from "#/utils/handler";
import {unique} from "#/utils/arrays";
import {getDidFromUri} from "#/utils/uri";
import {isLike} from "@atproto/api/dist/client/types/app/bsky/feed/getLikes";
import {isRecord as isRepost} from "@atproto/api/dist/client/types/app/bsky/feed/repost";


export const updateEngagementCountsHandler: CAHandler = async (ctx, agent, params) => {
    console.log("Added update engagement counts to queue.")
    await ctx.queue.add("update-engagement-counts", {})

    return {data: {}}
}


export async function updateEngagementCounts(ctx: AppContext) {
    console.log("Updating engagement counts...")

    // 1) Fetch everything and compute per‐record counts in JavaScript
    const records = await ctx.db.record.findMany({
        select: {
            uri: true,
            reactions: {select: {uri: true}}
        },
        where: {
            collection: {
                in: ["ar.cabildoabierto.feed.article", "app.bsky.feed.post"]
            }
        }
    })
    console.log("Got", records.length, "records")

    const counts = records.map(r => {
        const likesCount = unique(r.reactions.filter(isLike), l => getDidFromUri(l.uri)).length
        const repostsCount = unique(r.reactions.filter(isRepost), l => getDidFromUri(l.uri)).length
        return [r.uri, likesCount, repostsCount] as [string, number, number]
    })
    if (counts.length === 0) {
        console.log("Nothing to update")
        return
    }

    // 2) Build a Postgres VALUES list like:
    //    ('uri1',  5, 2),
    //    ('uri2', 10, 0),
    //    …
    const valuesList = counts
        .map(([uri, lc, rc]) => `('${uri.replace(/'/g, "''")}', ${lc}, ${rc})`)
        .join(",\n")

    // 3) Run one big raw‐SQL update
    //    - we assume your DB table is named `record`
    //    - and that your new columns are snake_cased `unique_likes_count` etc.

    try {
        await ctx.db.$executeRawUnsafe(`
        UPDATE "Record" AS r
        SET "uniqueLikesCount"   = v.ulc,
            "uniqueRepostsCount" = v.urc FROM (
      VALUES ${valuesList}
            ) AS v(uri, ulc, urc)
        WHERE r.uri = v.uri
    `)
    } catch (err) {
        console.log("Error updating engagement counts")
        console.log(err)
    }

    console.log("Updated engagement counts")
}
