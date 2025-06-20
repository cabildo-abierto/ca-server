import {CAHandler} from "#/utils/handler";
import {Notification as BskyNotification} from "#/lex-api/types/app/bsky/notification/listNotifications"


export const getNotifications: CAHandler<{}, BskyNotification[]> = async (ctx, agent, {}) => {

    const {data} = await agent.bsky.app.bsky.notification.listNotifications()


    return {data: data.notifications}
}