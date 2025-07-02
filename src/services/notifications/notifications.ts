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
import {getDid} from "@atproto/identity";


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
        reasonSubject: data.reasonSubject ?? undefined
    }
}


export type NotificationsSkeleton = {
    id: string
    causedByRecordId: string
}[]


async function getCANotifications(ctx: AppContext, agent: SessionAgent): Promise<Notification[]> {
    const dataplane = new Dataplane(ctx, agent)

    const skeleton: NotificationsSkeleton = await ctx.kysely
        .selectFrom("Notification")
        .innerJoin("Record", "Notification.causedByRecordId", "Record.uri")
        .select([
            "Notification.id",
            "Notification.causedByRecordId"
        ])
        .where("Notification.userNotifiedId", "=", agent.did)
        .orderBy("Notification.created_at", "desc")
        .limit(20)
        .execute()

    console.log("CA Notifications skeleton", skeleton)

    await dataplane.fetchNotificationsHydrationData(skeleton)

    const lastReadTime = new Date()

    return skeleton
        .map(n => hydrateCANotification(n.id, dataplane, lastReadTime))
        .filter(n => n != null)
}


export const getNotifications: CAHandler<{}, Notification[]> = async (ctx, agent, {}) => {


    const [{data}, _, caNotifications] = await Promise.all([
        agent.bsky.app.bsky.notification.listNotifications(),
        agent.bsky.app.bsky.notification.updateSeen({seenAt: new Date().toISOString()}),
        getCANotifications(ctx, agent)
    ])

    // le tenemos que agregar a las notificaciones la lista de notificaciones propias de CA
    // - alguien editó un tema que editaste
    // - alguien votó una edición de un tema
    // - se verificó tu cuenta
    // - alguien te mencionó en un artículo o tema
    // - alguien respondió a un artículo tuyo
    // - alguien respondió a un tema que editaste

    const bskyNotifications = data.notifications.map(bskyNotificationToCA)

    console.log("caNotifications", caNotifications)

    const notifications = sortByKey(
        [...bskyNotifications, ...caNotifications],
        a => a.indexedAt,
        sortDatesDescending
    )

    return {data: notifications}
}


export const getUnreadNotificationsCount: CAHandler<{}, number> = async (ctx, agent, {}) => {
    const {data} = await agent.bsky.app.bsky.notification.getUnreadCount()

    return {data: data.count}
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
                    .select(['uri', 'topicId'])
                    .where('uri', 'in', data.uris)
            )
            .selectFrom("InputVersions")
            .innerJoin('TopicVersion as tv', 'InputVersions.topicId', 'tv.topicId')
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
