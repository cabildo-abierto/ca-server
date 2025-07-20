import {CAHandler} from "#/utils/handler";


export type NextMeeting = {show: false} | {
    date: Date
    url: string
    show: true
    title: string
    description: string
}


export const getNextMeeting: CAHandler<{}, NextMeeting> = async (ctx, agent, {}) => {
    const meetings = await ctx.kysely
        .selectFrom("Meeting")
        .select(["Meeting.date", "Meeting.title", "Meeting.description", "Meeting.url", "Meeting.show"])
        .orderBy("Meeting.date", "desc")
        .limit(1)
        .execute()
    if(meetings && meetings.length > 0){
        const next = meetings[0]
        if(next.show){
            return {
                data: {
                    show: true,
                    date: next.date,
                    title: next.title,
                    description: next.description,
                    url: next.url
                }
            }
        }
    }
    return {data: {show: false}}
}