import {fetchBlob} from "../blob";
import {unique} from "#/utils/arrays";
import {getDidFromUri} from "#/utils/uri";
import {AppContext} from "#/index";
import {SmallTopicProps, TopicHistoryProps, TopicProps, TopicSortOrder} from "#/lib/types";
import {logTimes} from "#/utils/utils";
import {CAHandler, CAHandlerOutput} from "#/utils/handler";


export const getTopTrendingTopics: CAHandler<{}, SmallTopicProps[]> = async (ctx, agent) => {
    return await getTrendingTopics(ctx, [], "popular", 10)
}


export async function getTrendingTopics(
    ctx: AppContext,
    categories: string[],
    sortedBy: "popular" | "recent",
    limit: number): CAHandlerOutput<SmallTopicProps[]> {
    const where = {
        AND: categories.map((c) => {
            if (c == "Sin categoría") {
                return {categories: {none: {}}}
            } else {
                return {categories: {some: {categoryId: c}}}
            }
        }),
        versions: {
            some: {}
        }
    }

    const select = {
        id: true,
        popularityScore: true,
        lastEdit: true,
        categories: {
            select: {
                categoryId: true,
            }
        }
    }

    if (sortedBy == "popular") {
        const topics = await ctx.db.topic.findMany({
            select,
            where: {
                ...where,
                popularityScore: {
                    not: null
                }
            },
            orderBy: {
                popularityScore: "desc"
            },
            take: limit
        })
        return {
            data: topics.map(t => ({
                ...t,
                popularityScore: t.popularityScore ?? undefined,
                lastEdit: t.lastEdit ?? undefined
            } as SmallTopicProps))
        }
    } else {
        const where = {
            AND: categories.map((c) => {
                if (c == "Sin categoría") {
                    return {categories: {none: {}}}
                } else {
                    return {categories: {some: {categoryId: c}}}
                }
            }),
            versions: {
                some: {}
            }
        }
        const topics = await ctx.db.topic.findMany({
            select,
            where: {
                ...where,
                lastEdit: {
                    not: null
                }
            },
            orderBy: {
                lastEdit: "desc"
            },
            take: limit
        })
        return {
            data: topics.map(t => ({
                ...t,
                popularityScore: t.popularityScore ?? undefined,
                lastEdit: t.lastEdit ?? undefined
            } as SmallTopicProps))
        }
    }
}

export async function getCategories(ctx: AppContext) {
    const categoriesP = ctx.db.topicCategory.findMany({
        select: {
            id: true,
            _count: {
                select: {
                    topics: true
                }
            }
        }
    })

    const noCategoryCountP = ctx.db.topic.count({
        where: {
            categories: {
                none: {}
            }
        }
    })

    let [categories, noCategoryCount] = await Promise.all([categoriesP, noCategoryCountP])

    categories = categories.filter(c => (c._count.topics > 0))

    const res = categories.map(({id, _count}) => ({category: id, size: _count.topics}))
    res.push({category: "Sin categoría", size: noCategoryCount})
    return res
}


export async function getTextFromBlob(blob: { cid: string, authorId: string }) {
    try {
        const response = await fetchBlob(blob)
        if (!response || !response.ok) return null
        const responseBlob = await response.blob()
        if (!responseBlob) return null
        return await responseBlob.text()
    } catch (e) {
        console.error("Error getting text from blob", blob)
        console.error(e)
        return null
    }
}


export async function getTopicHistory(ctx: AppContext, id: string): Promise<{
    topicHistory?: TopicHistoryProps,
    error?: string
}> {
    try {
        const versions = await ctx.db.record.findMany({
            select: {
                uri: true,
                cid: true,
                collection: true,
                createdAt: true,
                author: {
                    select: {
                        did: true,
                        handle: true,
                        displayName: true,
                        avatar: true
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
                                categories: true,
                                synonyms: true,
                                title: true
                            }
                        }
                    }
                },
                accepts: {
                    select: {
                        uri: true
                    }
                },
                rejects: {
                    select: {
                        uri: true
                    }
                }
            },
            where: {
                content: {
                    topicVersion: {
                        topicId: id
                    }
                }
            },
            orderBy: {
                createdAt: "asc"
            }
        })

        const topicHistory = {
            id,
            versions: versions.map(v => ({
                ...v,
                uniqueAccepts: unique(v.accepts.map(a => getDidFromUri(a.uri))).length,
                uniqueRejects: unique(v.rejects.map(a => getDidFromUri(a.uri))).length,
                content: {
                    ...v.content,
                    hasText: v.content != null && (v.content.textBlob != null || v.content.text != null)
                }
            }))
        } as TopicHistoryProps // TO DO

        return {topicHistory}
    } catch (e) {
        console.error("Error getting topic " + id)
        console.error(e)
        return {error: "No se pudo obtener el historial."}
    }
}


export async function getTopicById(ctx: AppContext, id: string): Promise<{ topic?: TopicProps, error?: string }> {
    const t1 = Date.now()
    const topic = await ctx.db.topic.findUnique({
        select: {
            id: true,
            protection: true,
            synonyms: true,
            categories: {
                select: {
                    categoryId: true,
                }
            },
            popularityScore: true,
            lastEdit: true,
            currentVersion: {
                select: {
                    uri: true,
                    content: {
                        select: {
                            text: true,
                            format: true,
                            textBlob: {
                                select: {
                                    cid: true,
                                    authorId: true
                                }
                            },
                            record: {
                                select: {
                                    cid: true,
                                    author: {
                                        select: {
                                            did: true,
                                            handle: true,
                                            displayName: true,
                                            avatar: true
                                        }
                                    },
                                    createdAt: true
                                }
                            }
                        }
                    }
                }
            },
            currentVersionId: true,
            _count: {
                select: {
                    versions: true
                }
            }
        },
        where: {
            id: id
        }
    })

    if (!topic || topic._count.versions == 0) return {error: "No se encontró el tema " + id + "."}

    if (topic.currentVersion && !topic.currentVersion.content.text) {
        if (topic.currentVersion.content.textBlob) {
            topic.currentVersion.content.text = await getTextFromBlob(
                topic.currentVersion.content.textBlob
            )
        }
    }

    const t2 = Date.now()

    logTimes("getTopicById", [t1, t2])
    return {topic: topic as TopicProps}
}


export async function getTopicVersion(ctx: AppContext, uri: string) {
    try {
        const topicVersion = await ctx.db.record.findUnique({
            select: {
                uri: true,
                cid: true,
                createdAt: true,
                content: {
                    select: {
                        text: true,
                        textBlob: true,
                        format: true
                    }
                }
            },
            where: {
                uri: uri
            }
        })
        if (!topicVersion) {
            return {error: "No se encontró el contenido."}
        }

        if (topicVersion.content && !topicVersion.content.text) {
            if (topicVersion.content.textBlob) {
                topicVersion.content.text = await getTextFromBlob(
                    topicVersion.content.textBlob
                )
            }
        }

        return {
            topicVersion: {
                ...topicVersion,
                content: {
                    ...topicVersion.content,
                    record: {
                        uri: topicVersion.uri,
                        cid: topicVersion.cid,
                        createdAt: topicVersion.createdAt
                    }
                }
            }
        }
    } catch {
        return {error: "No se encontró el tema."}
    }
}


/*

function showAuthors(topic: TopicHistoryProps, topicVersion: TopicVersionProps) {
    const versionText = topicVersion.content.text

    function newAuthorNode(authors: string[], childNode){
        const authorNode: SerializedAuthorNode = {
            children: [childNode],
            type: "author",
            authors: authors,
            direction: 'ltr',
            version: childNode.version,
            format: 'left',
            indent: 0
        }
        return authorNode
    }

    const parsed = editorStateFromJSON(versionText)
    if(!parsed) {
        return versionText
    }
    let prevNodes = []
    let prevAuthors = []

    for(let i = 0; i < topic.versions.length; i++){
        const parsedVersion = editorStateFromJSON(decompress(topic.versions[i].content.text))
        if(!parsedVersion) continue
        const nodes = parsedVersion.root.children
        const {matches} = JSON.parse(topic.versions[i].content.topicVersion.diff)
        const versionAuthor = topic.versions[i].author.did
        let nodeAuthors: string[] = []
        for(let j = 0; j < nodes.length; j++){
            let authors = null
            for(let k = 0; k < matches.length; k++){
                if(matches[k] && matches[k].y == j){
                    const prevNodeAuthors = prevAuthors[matches[k].x]
                    if(getAllText(prevNodes[matches[k].x]) == getAllText(nodes[matches[k].y])){
                        authors = prevNodeAuthors
                    } else {
                        if(!prevNodeAuthors.includes(versionAuthor)){
                            authors = [...prevNodeAuthors, versionAuthor]
                        } else {
                            authors = prevNodeAuthors
                        }
                    }
                    break
                }
            }
            if(authors === null) authors = [versionAuthor]
            nodeAuthors.push(authors)
        }
        prevAuthors = [...nodeAuthors]
        prevNodes = [...nodes]
        if(topic.versions[i].uri == topicVersion.uri) break
    }
    const newChildren = []
    for(let i = 0; i < prevNodes.length; i++){
        newChildren.push(newAuthorNode(prevAuthors[i], prevNodes[i]))
    }
    parsed.root.children = newChildren
    return JSON.stringify(parsed)
}
 */


export async function getTopicVersionAuthors(uri: string): Promise<{
    topicVersionAuthors?: { text: string },
    error?: string
}> {
    return {
        topicVersionAuthors: {
            text: "Sin implementar"
        },
        error: undefined
    }
}


export async function getTopicVersionChanges(uri: string): Promise<{
    topicVersionChanges?: { text: string },
    error?: string
}> {
    return {
        topicVersionChanges: {
            text: "Sin implementar"
        },
        error: undefined
    }
}