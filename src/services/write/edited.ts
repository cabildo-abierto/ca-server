import {AppContext} from "#/setup.js";


export async function updateContentsEditedStatus(ctx: AppContext, uris: string[]) {
    if(uris.length == 0) return

    const edited = await ctx.kysely
        .selectFrom("Content")
        .innerJoin("Record", "Content.uri", "Record.uri")
        .select(eb => [
            "Content.uri",
            eb.exists(eb
                .selectFrom("Reaction")
                .select([])
                .whereRef("Reaction.subjectId", "=", "Content.uri")
                .whereRef("Reaction.subjectCid", "!=", "Record.cid")
            ).as("reactions"),
            eb.exists(eb
                .selectFrom("Post")
                .select([])
                .whereRef("Post.replyToId", "=", "Content.uri")
                .whereRef("Post.replyToCid", "!=", "Record.cid")
            ).as("replies"),
            eb.exists(eb
                .selectFrom("Post")
                .select([])
                .whereRef("Post.quoteToId", "=", "Content.uri")
                .whereRef("Post.quoteToCid", "!=", "Record.cid")
            ).as("quotes")
        ])
        .where("Content.uri", "in", uris)
        .execute()

    await ctx.kysely
        .insertInto("Content")
        .values(edited.map(c => ({
            uri: c.uri,
            edited: Boolean(c.reactions || c.replies || c.quotes),
            selfLabels: [],
            embeds: []
        })))
        .onConflict(oc => oc.column("uri").doUpdateSet(eb => ({
            edited: eb => eb.ref("excluded.edited")
        })))
        .execute()
}