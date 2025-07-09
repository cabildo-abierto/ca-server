
import {CAHandler} from "#/utils/handler";
import {TopicProp} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion";
import {SessionAgent} from "#/utils/session-agent";
import {PrismaTransactionClient} from "#/services/sync/sync-update";
import {CategoryVotes, TopicHistory, TopicVersionStatus, VersionInHistory} from "#/lex-api/types/ar/cabildoabierto/wiki/topicVersion"
import {getCollectionFromUri} from "#/utils/uri";
import {dbUserToProfileViewBasic} from "#/services/wiki/topics";


function getViewerForTopicVersionInHistory(reactions: {uri: string, subjectId: string | null}[]): VersionInHistory["viewer"] {
    let accept: string | undefined
    let reject: string | undefined

    if (reactions) {
        reactions.forEach(a => {
            const collection = getCollectionFromUri(a.uri)
            if (collection == "ar.cabildoabierto.wiki.voteAccept") {
                accept = a.uri
            } else if (collection == "ar.cabildoabierto.wiki.voteReject") {
                reject = a.uri
            }
        })
    }
    return {
        accept, reject
    }
}


export async function getTopicHistory(db: PrismaTransactionClient, id: string, agent?: SessionAgent) {
    const versions = await db.record.findMany({
        select: {
            uri: true,
            cid: true,
            createdAt: true,
            author: {
                select: {
                    did: true,
                    handle: true,
                    displayName: true,
                    avatar: true,
                    CAProfileUri: true
                }
            },
            content: {
                select: {
                    textBlob: true,
                    text: true,
                    topicVersion: {
                        select: {
                            charsAdded: true,
                            charsDeleted: true,
                            accCharsAdded: true,
                            contribution: true,
                            diff: true,
                            message: true,
                            props: true,
                            title: true,
                            prevAcceptedUri: true,
                            authorship: true
                        }
                    }
                }
            },
            uniqueAcceptsCount: true,
            uniqueRejectsCount: true,
            reactions: agent?.did ? {
                select: {
                    uri: true
                },
                where: {
                    record: {
                        collection: {
                            in: [
                                "ar.cabildoabierto.wiki.voteAccept",
                                "ar.cabildoabierto.wiki.voteReject"
                            ]
                        },
                        authorId: agent.did
                    }
                }
            } : undefined
        },
        where: {
            content: {
                topicVersion: {
                    topicId: id
                }
            },
            cid: {
                not: null
            }
        },
        orderBy: {
            createdAt: "asc"
        }
    })

    const topicHistory: TopicHistory = {
        id,
        versions: versions.map(v => {
            if (!v.content || !v.content.topicVersion || !v.cid) return null

            const viewer = getViewerForTopicVersionInHistory(v.reactions)

            const voteCounts: CategoryVotes[] = [
                {
                    accepts: v.uniqueAcceptsCount,
                    rejects: v.uniqueRejectsCount,
                    category: "Beginner" // TO DO
                }
            ]

            const author = dbUserToProfileViewBasic(v.author)
            if (!author) return null

            const status: TopicVersionStatus = {
                voteCounts
            }

            const contributionStr = v.content.topicVersion.contribution
            const contribution = contributionStr ? JSON.parse(contributionStr) : undefined

            const props = Array.isArray(v.content.topicVersion.props) ? v.content.topicVersion.props as unknown as TopicProp[] : []

            const view: VersionInHistory = {
                $type: "ar.cabildoabierto.wiki.topicVersion#versionInHistory",
                uri: v.uri,
                cid: v.cid,
                author: {
                    ...author,
                    $type: "app.bsky.actor.defs#profileViewBasic"
                },
                message: v.content.topicVersion.message,
                viewer,
                status: status,
                addedChars: v.content.topicVersion.charsAdded ?? undefined,
                removedChars: v.content.topicVersion.charsDeleted ?? undefined,
                props,
                createdAt: v.createdAt.toISOString(),
                contribution,
                prevAccepted: v.content.topicVersion.prevAcceptedUri ?? undefined,
                claimsAuthorship: v.content.topicVersion.authorship ?? false
            }
            return view
        }).filter(v => v != null)
    }
    return topicHistory
}

export const getTopicHistoryHandler: CAHandler<{
    params: { id: string }
}, TopicHistory> = async (ctx, agent, {params}) => {
    const {id} = params
    try {
        const topicHistory = await getTopicHistory(ctx.db, id, agent)

        return {data: topicHistory}
    } catch (e) {
        console.error("Error getting topic " + id)
        console.error(e)
        return {error: "No se pudo obtener el historial."}
    }
}