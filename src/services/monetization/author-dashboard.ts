import {CAHandler} from "#/utils/handler.js";
import {getTopicTitle} from "#/services/wiki/utils.js";
import {TopicProp, TopicVersionStatus} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion.js";
import {sql} from "kysely";
import {getSessionData} from "#/services/user/users.js";
import {isVersionAccepted} from "#/services/wiki/current-version.js";
import {getCollectionFromUri, getDidFromUri} from "#/utils/uri.js";
import {AppContext} from "#/setup.js";
import {orderNumberDesc, sortByKey, sum} from "#/utils/arrays.js";
import {ReadChunks, ReadChunksAttr} from "#/services/monetization/read-tracking.js";
import {FULL_READ_DURATION, joinManyChunks} from "#/services/monetization/user-months.js";

type ArticleStats = {
    uri: string
    created_at: Date
    title: string
    seenBy: number
    seenByVerified: number
    avgReadFraction: number | null
    avgReadFractionVerified: number | null
    income: number
    likes: number
}


type EditedTopicStats = {
    topicId: string
    topicTitle: string
    first_edit: Date
    last_edit: Date
    edits_count: number
    topicSeenBy: number
    topicSeenByVerified: number
    contribution: number | null
    monetizedContribution: number | null
    income: number
}


type AuthorDashboard = {
    articles: ArticleStats[]
    edits: EditedTopicStats[]
    totalReadByArticles: number | null
    totalReadByArticlesVerified: number | null
    avgReadFractionArticles: number | null
    avgReadFractionArticlesVerified: number | null
    totalReadByEdits: number | null
    totalReadByEditsVerified: number | null
    totalIncome: number | null
}


type TopicVersionQueryResult = {
    topicId: string,
    props: unknown,
    contribution: string | null,
    created_at: Date
    reactions: unknown
    protection: string
    seenBy: number
    seenByVerified: number
    income: number | null
}


export function getTopicVersionStatusFromReactions(reactions: { uri: string, editorStatus: string }[]): TopicVersionStatus {
    const byEditorStatus = new Map<string, string[]>()
    reactions.forEach(r => {
        const cur = byEditorStatus.get(r.editorStatus)
        if (cur) {
            cur.push(r.uri)
            byEditorStatus.set(r.editorStatus, cur)
        } else {
            byEditorStatus.set(r.editorStatus, [r.uri])
        }
    })
    return {
        voteCounts: Array.from(byEditorStatus.entries()).map(([k, v]) => {
            return {
                $type: "ar.cabildoabierto.wiki.topicVersion#categoryVotes",
                accepts: new Set(v
                    .filter(v => getCollectionFromUri(v) == "ar.cabildoabierto.wiki.topicAccept")
                    .map(getDidFromUri))
                    .size,
                rejects: new Set(v
                    .filter(v => getCollectionFromUri(v) == "ar.cabildoabierto.wiki.topicReject")
                    .map(getDidFromUri))
                    .size,
                category: k
            }
        })
    }
}


async function getTopicsForDashboardQuery(ctx: AppContext, did: string) {
    const [edits, user] = await Promise.all([
        ctx.kysely
            .selectFrom('TopicVersion')
            .innerJoin('Record', 'TopicVersion.uri', 'Record.uri')
            .innerJoin('Topic', 'Topic.id', 'TopicVersion.topicId')
            .innerJoin(
                'TopicVersion as TopicCurrentVersion',
                'TopicCurrentVersion.uri',
                'Topic.currentVersionId'
            )

            .leftJoin("Reaction", "Reaction.subjectId", "TopicVersion.uri")
            .leftJoin("Record as ReactionRecord", "Reaction.uri", "ReactionRecord.uri")
            .leftJoin("User as ReactionAuthor", "ReactionAuthor.did", "ReactionRecord.authorId")

            .leftJoin("ReadSession", "ReadSession.topicId", "Topic.id")
            .leftJoin("User as Reader", "Reader.did", "ReadSession.userId")

            .select([
                'TopicVersion.uri',
                'TopicVersion.topicId',
                'TopicVersion.contribution',
                'Topic.protection',
                'Record.created_at',
                'TopicCurrentVersion.props',
                sql`
                    COALESCE(
                    json_agg(
                      json_build_object(
                        'uri', "Reaction"."uri",
                        'editorStatus', "ReactionAuthor"."editorStatus"
                      )
                    ) FILTER (WHERE "Reaction"."uri" IS NOT NULL),
                    '[]'
                  )
                `.as('reactions'),
                eb => eb.fn.count<number>("ReadSession.userId")
                    .distinct()
                    .filterWhereRef('ReadSession.created_at', '>', 'Record.created_at')
                    .filterWhereRef("ReadSession.userId", "!=", "Record.authorId")
                    .as("seenBy"),
                eb => eb.fn.count<number>("ReadSession.userId")
                    .distinct()
                    .filterWhereRef('ReadSession.created_at', '>', 'Record.created_at')
                    .filterWhereRef("ReadSession.userId", "!=", "Record.authorId")
                    .filterWhere("Reader.userValidationHash", "is not", null)
                    .as("seenByVerified"),
                eb => eb.selectFrom('PaymentPromise')
                    .whereRef('PaymentPromise.contentId', '=', 'TopicVersion.uri')
                    .select(eb => eb.fn.sum<number>('PaymentPromise.amount').as("income"))
                    .as('income')
            ])
            .where('Record.authorId', '=', did)
            .groupBy([
                'TopicVersion.uri',
                'TopicVersion.topicId',
                'TopicVersion.contribution',
                'Record.created_at',
                'TopicCurrentVersion.props',
                "Topic.protection"
            ])
            .orderBy("Record.created_at", "asc")
            .execute(),
        getSessionData(ctx, did)
    ])

    if(!user) return {error: `No se encontró el usuario: ${did}.`}

    const byTopics = new Map<string, TopicVersionQueryResult[]>()
    edits.forEach(tv => {
        const cur = byTopics.get(tv.topicId)
        if (cur) {
            byTopics.set(tv.topicId, [...cur, tv])
        } else {
            byTopics.set(tv.topicId, [tv])
        }
    })

    const editStats = Array.from(byTopics.entries()).map(([id, t]) => {
        const title = getTopicTitle({id: t[0].topicId, props: t[0].props as TopicProp[] | undefined})

        let contribution: number | null = 0
        let monetizedContribution: number | null = 0
        for (const tv of t) {
            if (tv.contribution) {
                const c = JSON.parse(tv.contribution)
                contribution += c.all
                monetizedContribution += c.monetized
            }
        }

        let acceptedCount = 0
        for (const tv of t) {
            const reactions = tv.reactions as { uri: string, editorStatus: string }[]

            const status: TopicVersionStatus = getTopicVersionStatusFromReactions(reactions)

            const protection = tv.protection
            const accepted = isVersionAccepted(user.editorStatus, protection, status)
            if (accepted) acceptedCount++
        }

        return {
            topicId: id,
            edits_count: t.length,
            first_edit: t[0].created_at,
            last_edit: t[t.length - 1].created_at,
            topicTitle: title,
            income: sum(t, x => x.income ?? 0),
            acceptedCount,
            contribution,
            monetizedContribution,
            topicSeenBy: t[0].seenBy,
            topicSeenByVerified: t[0].seenByVerified
        }
    })

    return {
        data: sortByKey(editStats, e => e.topicSeenBy, orderNumberDesc)
    }
}


export function getReadPercentageFromChunks(chunks: ReadChunks, totalChunks: number | null): number {
    let total = 0
    chunks.forEach(c => {
        total += Math.min(c.duration / 1000 / FULL_READ_DURATION, 1)
    })
    return Math.min(total / (totalChunks ?? (Math.max(...chunks.map(c => c.chunk))+1)), 1)
}


function getAvgReadFraction(readSessions: any[] | undefined, did: string) {
    if(!readSessions) return null
    const sessionsByUser = new Map<string, ReadChunksAttr[]>()
    readSessions.forEach(s => {
        sessionsByUser.set(s.userId, [
            ...(sessionsByUser.get(s.userId) ?? []),
            s.readChunks as ReadChunksAttr
        ])
    })

    return sum(Array.from(sessionsByUser.entries()).filter(([readerDid, s]) => s.length > 0 && readerDid != did), ([did, s]) => {
        const allUserChunks = s.map(s => s.chunks)
        const chunks = joinManyChunks(allUserChunks)
        return getReadPercentageFromChunks(chunks, s[0].totalChunks)
    }) / sessionsByUser.size
}


async function getArticlesForDashboardQuery(ctx: AppContext, did: string): Promise<ArticleStats[]> {

    const [readSessions, paymentPromises] = await Promise.all([
        ctx.kysely
            .selectFrom("Article")
            .innerJoin("Record", "Article.uri", "Record.uri")
            .leftJoin('ReadSession', 'ReadSession.readContentId', 'Record.uri')
            .leftJoin("User as Reader", "Reader.did", "ReadSession.userId")
            .select([
                "Article.uri",
                "Article.title",
                "Record.created_at",
                "ReadSession.readChunks",
                "ReadSession.userId",
                "Reader.userValidationHash",
                "Record.uniqueLikesCount"
            ])
            .where("Record.authorId", "=", did)
            .execute(),
        ctx.kysely
            .selectFrom("Article")
            .innerJoin("Record", "Article.uri", "Record.uri")
            .leftJoin('PaymentPromise', 'PaymentPromise.contentId', 'Record.uri')
            .select([
                "Article.uri",
                eb => eb.fn.sum<number>("PaymentPromise.amount").as("income")
            ])
            .groupBy([
                "Article.uri"
            ])
            .where("Record.authorId", "=", did)
            .execute()
    ])

    const m = new Map<string, {
        uri: string
        title: string
        created_at: Date
        uniqueLikesCount: number
        income: number | null
        readSessions?: {readChunks: unknown, userId: string, verified: boolean}[]
    }>()

    readSessions.forEach(r => {
        const cur = m.get(r.uri)
        const readSessions = r.readChunks && r.userId ?
            [...(cur && cur.readSessions ? cur.readSessions : []), {
            readChunks: r.readChunks, userId: r.userId, verified: r.userValidationHash != null}]
            :
            cur?.readSessions
        m.set(r.uri, {
            uri: r.uri,
            title: r.title,
            created_at: r.created_at,
            readSessions,
            income: null,
            uniqueLikesCount: r.uniqueLikesCount
        })
    })

    paymentPromises.forEach(p => {
        const cur = m.get(p.uri)
        if(!cur) return
        m.set(p.uri, {
            ...cur,
            income: p.income
        })
    })

    return sortByKey(Array.from(m.values()).map(a => {
        const seenBy = new Set(a.readSessions?.map(a => a.userId))
        seenBy.delete(did)

        const verifiedReadSessions = a.readSessions?.filter(r => r.verified)
        const seenByVerified = new Set<string>(
            verifiedReadSessions?.map(r => r.userId)
        )
        seenByVerified.delete(did)

        const avgReadFraction = getAvgReadFraction(a.readSessions, did)
        const avgReadFractionVerified = getAvgReadFraction(verifiedReadSessions, did)

        return {
            uri: a.uri,
            created_at: a.created_at,
            title: a.title,
            seenBy: seenBy.size,
            seenByVerified: seenByVerified.size,
            avgReadFraction,
            avgReadFractionVerified,
            income: a.income ?? 0,
            likes: a.uniqueLikesCount
        }
    }), x => x.income, orderNumberDesc)
}


export async function getAuthorDashboard(ctx: AppContext, did: string) {
    const [articles, editStats] = await Promise.all([
        getArticlesForDashboardQuery(ctx, did),
        getTopicsForDashboardQuery(ctx, did),
    ])

    if(!editStats.data) return {error: editStats.error}

    const totalReadByEdits = editStats.data.length > 0 ? sum(editStats.data, a => Number(a.topicSeenBy)) : null
    const totalReadByEditsVerified = editStats.data.length > 0 ? sum(editStats.data, a => Number(a.topicSeenByVerified)) : null

    const authorDashboard: AuthorDashboard = {
        articles,
        edits: editStats.data,
        totalReadByArticlesVerified: articles.length > 0 ? sum(articles, a => a.seenByVerified) : null,
        totalReadByArticles: articles.length > 0 ? sum(articles, a => a.seenBy) : null,
        avgReadFractionArticles: articles.length > 0 ? sum(articles, a => a.avgReadFraction ?? 0) / articles.length : null,
        avgReadFractionArticlesVerified: articles.length > 0 ? sum(articles, a => a.avgReadFractionVerified ?? 0) / articles.length : null,
        totalReadByEdits,
        totalReadByEditsVerified,
        totalIncome: sum([...articles, ...editStats.data], e => e.income)
    }

    return {
        data: authorDashboard
    }
}


export const getAuthorDashboardHandler: CAHandler<{}, AuthorDashboard> = async (ctx, agent, params) => {
    return getAuthorDashboard(ctx, agent.did)
}