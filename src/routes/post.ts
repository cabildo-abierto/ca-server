import express from 'express'
import type {AppContext} from '#/index'
import {sessionAgent, handler} from "#/utils/session-agent";
import {createPost} from "#/services/write/post";
import {ATProtoStrongRef} from "#/lib/types";
import {makeHandler} from "#/utils/handler";

const router = express.Router()

export type FastPostReplyProps = {
    parent: ATProtoStrongRef
    root: ATProtoStrongRef
}

export type ImagePayload = {src: string, $type: "url"} | {image: string, $type: "str"}

export type CreatePostProps = {
    text: string
    reply?: FastPostReplyProps
    selection?: [number, number]
    images?: ImagePayload[]
    enDiscusion?: boolean
}


export default function postRoutes(ctx: AppContext) {
    router.post(
        '/post',
        handler(makeHandler(ctx, createPost))
    )

    return router
}
