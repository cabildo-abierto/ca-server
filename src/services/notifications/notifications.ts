import {CAHandler} from "#/utils/handler";
import {Notification as BskyNotification} from "#/lex-api/types/app/bsky/notification/listNotifications"


export const getNotifications: CAHandler<{}, BskyNotification[]> = async (ctx, agent, {}) => {

    const {data} = await agent.bsky.app.bsky.notification.listNotifications()

    agent.bsky.app.bsky.notification.updateSeen({seenAt: new Date().toISOString()})

    return {data: data.notifications}
}


export const getUnreadNotificationsCount: CAHandler<{}, number> = async (ctx, agent, {}) => {
    const {data} = await agent.bsky.app.bsky.notification.getUnreadCount()

    return {data: data.count}
}
