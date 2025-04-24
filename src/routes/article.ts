import express from 'express'
import type {AppContext} from '#/index'
import {handler} from "#/utils/session-agent";
import {createArticle} from "#/services/write/article";
import {makeHandler} from "#/utils/handler";

const router = express.Router()

export type CreateArticleProps = {
    title: string
    format: string
    text: string
}


export default function articleRoutes(ctx: AppContext) {
    router.post(
        '/article',
        handler(makeHandler(ctx, createArticle))
    )

    return router
}
