import {CAHandler} from "#/utils/handler.js";
import {
    ConvoView,
    DeletedMessageView,
    MessageInput,
    MessageView
} from "@atproto/api/dist/client/types/chat/bsky/convo/defs.js";
import {$Typed} from "@atproto/api";


export const getConversations: CAHandler<{}, ConvoView[]> = async (ctx, agent, params) => {
    const chatAgent = agent.bsky.withProxy("bsky_chat", "did:web:api.bsky.chat")

    const {data} = await chatAgent.chat.bsky.convo.listConvos()

    return {data: data.convos}
}

type SendMessageParams = { message: MessageInput, convoId: string }

export const sendMessage: CAHandler<SendMessageParams, {}> = async (ctx, agent, params) => {
    const chatAgent = agent.bsky.withProxy("bsky_chat", "did:web:api.bsky.chat")

    await chatAgent.chat.bsky.convo.sendMessage(params)

    return {data: {}}
}

export type Conversation = {
    messages: ($Typed<MessageView> | $Typed<DeletedMessageView> | { $type: string })[]
    conversation: ConvoView
}

export const getConversation: CAHandler<{
    params: { convoId: string }
}, Conversation> = async (ctx, agent, {params}) => {
    const chatAgent = agent.bsky.withProxy("bsky_chat", "did:web:api.bsky.chat")

    const {convoId} = params
    const [{data}, {data: convData}] = await Promise.all([
        chatAgent.chat.bsky.convo.getMessages({convoId}),
        chatAgent.chat.bsky.convo.getConvo({convoId})
    ])

    return {
        data: {
            messages: data.messages,
            conversation: convData.convo
        }
    }
}


export const createConversation: CAHandler<{params: {did: string}}, {convoId: string}> = async (ctx, agent, {params}) => {
    const {did} = params
    const chatAgent = agent.bsky.withProxy("bsky_chat", "did:web:api.bsky.chat")
    try {
        const convo = await chatAgent.chat.bsky.convo.getConvoForMembers({members: [did]})
        return {data: {convoId: convo.data.convo.id}}
    } catch (err) {
        console.log("No se pudo iniciar la conversación")
        console.log(err)
        return {error: "No se pudo iniciar la conversación."}
    }
}


export const markConversationRead: CAHandler<{params: {convoId: string}}, {}> = async (ctx, agent, {params}) => {
    const chatAgent = agent.bsky.withProxy("bsky_chat", "did:web:api.bsky.chat")

    await chatAgent.chat.bsky.convo.updateRead({convoId: params.convoId})

    return {data: {}}
}