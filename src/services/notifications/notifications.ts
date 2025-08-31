import {CAHandler} from "#/utils/handler";
import {Notification as BskyNotification} from "#/lex-api/types/app/bsky/notification/listNotifications"
import {Notification} from "#/lex-api/types/ar/cabildoabierto/notification/listNotifications"
import {AppContext} from "#/index";
import {v4 as uuidv4} from "uuid";
import {NotificationType} from "../../../prisma/generated/types";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {ProfileViewBasic as CAProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs";
import {ProfileView} from "#/lex-api/types/app/bsky/actor/defs";
import {sortByKey, unique} from "#/utils/arrays";
import {sortDatesDescending} from "#/utils/dates";
import {SessionAgent} from "#/utils/session-agent";
import {getDidFromUri} from "#/utils/uri";


function bskyNotificationToCA(n: BskyNotification): Notification {
    return {
        ...n,
        $type: "ar.cabildoabierto.notification.listNotifications#notification"
    }
}


export type NotificationQueryResult = {
    id: string
    userNotifiedId: string
    causedByRecordId: string
    cid: string | null
    record: string | null
    message: string | null
    moreContext: string | null
    created_at: Date
    type: NotificationType
    reasonSubject: string | null
    topicId: string | null
}


function profileViewBasicToProfileView(user: CAProfileViewBasic): ProfileView {
    return {
        ...user,
        $type: "app.bsky.actor.defs#profileView"
    }
}


function hydrateCANotification(id: string, dataplane: Dataplane, lastReadTime: Date): Notification | null {
    const data = dataplane.notifications.get(id)
    if (!data) {
        console.log(`No hydration data for notification: ${id}`)
        return null
    }

    if(!data.cid) {
        console.log(`No cid for notification: ${id}`)
        return null
    }

    const author = hydrateProfileViewBasic(getDidFromUri(data.causedByRecordId), dataplane)
    if (!author) {
        console.log(`No author hydration data for notification: ${id}`)
        return null
    }

    let reason: Notification["reason"]
    if (data.type == "Reply") {
        reason = "reply"
    } else if (data.type == "Mention") {
        reason = "mention"
    } else if (data.type == "TopicEdit") {
        reason = "topic-edit"
    } else {
        reason = "topic-version-vote"
    }

    return {
        $type: "ar.cabildoabierto.notification.listNotifications#notification",
        reason,
        uri: data.causedByRecordId,
        cid: data.cid,
        author: profileViewBasicToProfileView(author),
        record: data.record ? JSON.parse(data.record) : undefined,
        isRead: data.created_at < lastReadTime,
        indexedAt: data.created_at.toISOString(),
        reasonSubject: data.reasonSubject ?? undefined,
        reasonSubjectContext: data.topicId ?? undefined
    }
}


export type NotificationsSkeleton = {
    id: string
    causedByRecordId: string
    reasonSubject: string | null
}[]



async function getCANotifications(ctx: AppContext, agent: SessionAgent): Promise<Notification[]> {
    const dataplane = new Dataplane(ctx, agent)

    const [skeleton, lastSeen] = await Promise.all([
        ctx.kysely
        .selectFrom("Notification")
        .innerJoin("Record", "Notification.causedByRecordId", "Record.uri")
        .select([
            "Notification.id",
            "Notification.causedByRecordId",
            "Notification.reasonSubject"
        ])
        .where("Notification.userNotifiedId", "=", agent.did)
        .orderBy("Notification.created_at", "desc")
        .limit(20)
        .execute(),
        ctx.kysely
            .selectFrom("User")
            .select("lastSeenNotifications")
            .where("did", "=", agent.did)
            .execute()
    ])

    await dataplane.fetchNotificationsHydrationData(skeleton)

    return skeleton
        .map(n => hydrateCANotification(n.id, dataplane, lastSeen[0].lastSeenNotifications))
        .filter(n => n != null)
}


async function updateSeenCANotifications(ctx: AppContext, agent: SessionAgent) {
    await ctx.kysely
        .updateTable("User")
        .set("lastSeenNotifications", new Date())
        .where("did", "=", agent.did)
        .execute()
}


export const getNotifications: CAHandler<{}, Notification[]> = async (ctx, agent, {}) => {
    const [{data}, caNotifications] = await Promise.all([
        agent.bsky.app.bsky.notification.listNotifications(),
        getCANotifications(ctx, agent),
        agent.bsky.app.bsky.notification.updateSeen({seenAt: new Date().toISOString()}),
        updateSeenCANotifications(ctx, agent)
    ])

    const bskyNotifications = data.notifications.map(bskyNotificationToCA)

    const notifications = sortByKey(
        [...bskyNotifications, ...caNotifications],
        a => a.indexedAt,
        sortDatesDescending
    )

    return {data: notifications}
}


export const getUnreadNotificationsCount: CAHandler<{}, number> = async (ctx, agent, {}) => {
    // queremos la cantidad de notificaciones no leídas entre CA y Bluesky
    // el punto clave es la timestamp de última lectura
    // va a haber dos timesamps:
    //  - última lectura en Bluesky O Cabildo Abierto
    //  - última lectura en Cabildo Abierto
    // la primera la maneja Bluesky, y la actualizamos desde CA también
    // la segunda es nuestra
    // en consecuencia, al ver las notificaciones en CA puede ser que se intercalen notificaciones leídas con no leídas
    // si la última lectura en Bluesky fue más reciente que la última lectura en CA

    const {data} = await agent.bsky.app.bsky.notification.getUnreadCount()

    const result = await ctx.kysely
        .selectFrom('Notification')
        .select(({ fn }) => [fn.count('id').as('count')])
        .where('userNotifiedId', '=', agent.did)
        .where('created_at', '>', (eb) =>
            eb
                .selectFrom('User')
                .select('lastSeenNotifications')
                .where('did', '=', agent.did)
        )
        .executeTakeFirst()

    const caUnreadCount = Number(result?.count ?? 0)

    return {data: data.count+caUnreadCount}
}


export type NotificationBatchData = {
    uris: string[]
    topics: string[]
} & ({
    subjectUris: string[]
    type: "TopicVersionVote"
} | {
    type: "TopicEdit"
})


export type NotificationJobData = {
    userNotifiedId: string
    type: NotificationType
    causedByRecordId: string
    message?: string
    moreContext?: string
    createdAt: string
    reasonSubject?: string
}


export const createNotificationJob = async (ctx: AppContext, data: NotificationJobData) => {
    await ctx.kysely
        .insertInto("Notification")
        .values([{
            id: uuidv4(),
            userNotifiedId: data.userNotifiedId,
            type: data.type,
            causedByRecordId: data.causedByRecordId,
            message: data.message,
            moreContext: data.moreContext,
            created_at: data.createdAt,
            reasonSubject: data.reasonSubject
        }])
        .onConflict(cb => cb.doNothing())
        .execute()
}


export const createNotificationsBatchJob = async (ctx: AppContext, data: NotificationBatchData) => {
    if(data.type == "TopicEdit") {
        if(data.uris.length == 0) return
        let relatedUris = await ctx.kysely
            .with('InputVersions', (qb) =>
                qb
                    .selectFrom('TopicVersion')
                    .innerJoin("Record", "Record.uri", "TopicVersion.uri")
                    .select(['uri', 'topicId', "Record.created_at"])
                    .where('uri', 'in', data.uris)
            )
            .selectFrom("InputVersions")
            .innerJoin('TopicVersion as tv', 'InputVersions.topicId', 'tv.topicId')
            .innerJoin("Record as tvRecord", "tvRecord.uri", "InputVersions.uri")
            .whereRef("InputVersions.created_at", ">", "tvRecord.created_at")
            .select([
                'InputVersions.uri as causeUri',
                'tv.uri as notifiedVersionUri',
                'tv.topicId as topicId',
            ])
            .execute()

        // no notificamos dos veces a un usuario que editó dos veces el mismo tema
        relatedUris = unique(relatedUris, e => `${e.causeUri}:${getDidFromUri(e.notifiedVersionUri)}`)

        // no notificamos al usuario que editó
        relatedUris = relatedUris.filter(e => getDidFromUri(e.notifiedVersionUri) != getDidFromUri(e.causeUri))

        const values = relatedUris.map((v, i) => {
            return {
                id: uuidv4(),
                created_at: new Date().toISOString(),
                type: data.type,
                causedByRecordId: v.causeUri,
                reasonSubject: v.topicId,
                userNotifiedId: getDidFromUri(v.notifiedVersionUri)
            }
        })

        if(values.length > 0){
            await ctx.kysely
                .insertInto("Notification")
                .values(values)
                .onConflict(cb => cb.doNothing())
                .execute()
        }
    } else if(data.type == "TopicVersionVote") {
        let values = data.uris.map((uri, i) => {
            return {
                id: uuidv4(),
                created_at: new Date().toISOString(),
                type: data.type,
                causedByRecordId: uri,
                reasonSubject: data.topics[i],
                userNotifiedId: getDidFromUri(data.subjectUris[i])
            }
        })

        values = values.filter(v =>
            getDidFromUri(v.causedByRecordId) != v.userNotifiedId
        )

        values = unique(values, v => `${v.userNotifiedId}:${v.causedByRecordId}`)

        if(values.length > 0){
            await ctx.kysely
                .insertInto("Notification")
                .values(values)
                .onConflict(cb => cb.doNothing())
                .execute()
        }
    }
}
