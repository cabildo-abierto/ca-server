import {setupAppContext} from "#/setup"


async function run() {
    const {ctx} = await setupAppContext([])

    const donations = await ctx.kysely
        .selectFrom("Notification")
        .innerJoin("Record", "Record.uri", "Notification.causedByRecordId")
        .select(["id", "Record.created_at_tz", "Record.uri"])
        .execute()


    const values: {id: string, created_at_tz: Date, type: "Mention", userNotifiedId: string, causedByRecordId: string}[] = []
    donations.forEach(d => {
        if(d.created_at_tz){
            values.push({
                id: d.id,
                created_at_tz: d.created_at_tz,
                type: "Mention",
                userNotifiedId: "did:plc:cpooyynmjuqtcyhujscrxme7",
                causedByRecordId: "at://did:plc:cpooyynmjuqtcyhujscrxme7/app.bsky.feed.post"
            })
        } else {
            console.log(d)
        }
    })

    console.log("values", values.length, donations.length)

    await ctx.kysely
        .insertInto("Notification")
        .values(values)
        .onConflict(oc => oc.column("id").doUpdateSet(() => ({
            created_at_tz: eb => eb.ref("excluded.created_at_tz"),
        })))
        .execute()

    ctx.logger.pino.info("updat done")
}

run()