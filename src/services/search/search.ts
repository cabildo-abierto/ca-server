import {cleanText} from "#/utils/strings";
import {CAHandler} from "#/utils/handler";
import {ProfileViewBasic} from "#/lex-api/types/app/bsky/actor/defs";


export const searchUsers: CAHandler<{query: string}, ProfileViewBasic[]> = async (ctx, agent, {query}) => {
    //const cleanQuery = cleanText(query)

    /*function isMatch(user: ProfileViewBasic) {
        return (
            (user.displayName && cleanText(user.displayName).includes(cleanQuery)) ||
            (user.handle && cleanText(user.handle).includes(cleanQuery))
        )
    }*/

    console.log("searching", query)
    const {data} = await agent.bsky.searchActorsTypeahead({q: query})

    console.log("returning", data.actors.length)

    return {data: data.actors}
}