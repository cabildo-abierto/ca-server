import {AppContext} from "#/index";
import {getMonthlyValue} from "#/services/monetization/donations";
import {getDidFromUri} from "#/utils/uri";
import {sum} from "#/utils/arrays";
import {JsonValue} from "@prisma/client/runtime/library";
import {ReadChunks, ReadChunksAttr} from "#/services/monetization/read-tracking";

function joinReadChunks(a: ReadChunks, b: ReadChunks): ReadChunks {
    const m = new Map<number, number>()
    a.forEach(c => {
        m.set(c.chunk, c.duration + (m.get(c.chunk) ?? 0))
    })
    b.forEach(c => {
        m.set(c.chunk, c.duration + (m.get(c.chunk) ?? 0))
    })
    return Array.from(m.entries()).map(([k, v]) => ({chunk: k, duration: v}))
}

export const FULL_READ_DURATION = 25

function countReadChunks(a: ReadChunks): number {
    return sum(a, x => Math.max(0, Math.min(x.duration / FULL_READ_DURATION, 1)))
}

export function joinManyChunks(chunks: ReadChunks[]): ReadChunks {
    return chunks.reduce((acc, c) => joinReadChunks(acc, c))
}

export function getChunksReadByContent(readSessions: { readContentId: string | null, readChunks: ReadChunksAttr }[]) {
    const chunksByContent = new Map<string, ReadChunks[]>()
    readSessions.forEach(readSession => {
        const k = readSession.readContentId
        if (k) {
            chunksByContent.set(k, [...chunksByContent.get(k) ?? [], readSession.readChunks.chunks])
        }
    })

    const chunksAccByContent = new Map<string, ReadChunks>(Array.from(chunksByContent.entries()).map(([k, v]) => [k, joinManyChunks(v)]))
    const chunksReadArray: [string, number][] = Array.from(chunksAccByContent.entries()).map(([k, v]) => ([k, countReadChunks(v)]))

    return new Map<string, number>(chunksReadArray)
}


function isActive(readSessions: { readContentId: string | null, readChunks: ReadChunksAttr }[]) {
    const m = getChunksReadByContent(readSessions)
    const authors = new Set<string>
    Array.from(m.entries()).forEach(([uri, readCount]) => {
        if (readCount > 0) {
            authors.add(getDidFromUri(uri))
        }
    })
    return authors.size > 0
}


type UserWithReadSessions = {
    did: string
    handle: string
    months: {
        monthStart: Date
        monthEnd: Date
    }[]
    readSessions: {
        readContentId: string | null,
        readChunks: JsonValue
        createdAt: Date
    }[]
}


export async function getUsersWithReadSessions(
    ctx: AppContext,
    after: Date = new Date(Date.now() - 60 * 24 * 3600 * 1000),
    verified: boolean = true
): Promise<UserWithReadSessions[]> {
    const users = await ctx.db.user.findMany({
        select: {
            did: true,
            handle: true,
            userValidationHash: true,
            months: {
                select: {
                    monthStart: true,
                    monthEnd: true
                },
                orderBy: {
                    monthStart: "desc"
                },
                take: 1
            },
            readSessions: {
                select: {
                    readContentId: true,
                    readChunks: true,
                    createdAt: true
                },
                orderBy: {
                    createdAt: "asc"
                },
                where: {
                    createdAt: {
                        gt: after
                    }
                }
            }
        },
        where: {
            inCA: true,
            hasAccess: true,
            userValidationHash: verified ? {
                not: null
            } : undefined
        }
    })

    const valid: UserWithReadSessions[] = []
    users.forEach(u => {
        if (u.handle != null) {
            valid.push({
                ...u,
                handle: u.handle
            })
        }
    })
    return valid
}


// el siguiente mes empieza en el momento en el que terminó el último
export function getNextMonthStart(user: {
    months: { monthStart: Date, monthEnd: Date }[],
    readSessions: { createdAt: Date }[]
}) {
    if (user.months.length == 0) {
        if (user.readSessions.length > 0) {
            return user.readSessions[0].createdAt
        } else {
            return null
        }
    } else {
        return user.months[0].monthEnd
    }
}


export async function createUserMonths(ctx: AppContext) {
    // Se crean UserMonths para todos los usuarios cuyo último user month haya terminado o que tengan readSesions pero no user months
    console.log("Creating user months...")

    let users = await getUsersWithReadSessions(ctx)
    console.log(`Got ${users.length} users.`)

    const value = getMonthlyValue()

    for (let user of users) {
        console.log(`Evaluating user ${user.handle}`)
        const monthStart = getNextMonthStart(user)

        if (!monthStart) {
            console.log(`${user.handle} todavía no empezó el primer mes.`)
            continue
        }

        if (monthStart > new Date()) {
            console.log(`${user.handle} tiene un mes asignado que no terminó. Revisar, no debería pasar.`)
            continue
        }

        const monthEnd = new Date(monthStart.getTime() + 30 * 24 * 3600 * 1000)

        if (monthEnd > new Date()) {
            console.log(`Skipeando a ${user.handle}, todavía no terminó el nuevo mes.`, {monthStart, monthEnd})
            continue
        }

        const readSessions = user.readSessions.filter(s => monthStart <= s.createdAt && monthEnd >= s.createdAt)

        const validatedReadSessions = readSessions.map(r => ({
            ...r,
            readChunks: r.readChunks as ReadChunksAttr
        }))
        const active = isActive(validatedReadSessions)

        console.log(`Creating user month (${monthStart}, ${monthEnd}) for ${user.handle}`)
        await ctx.db.userMonth.create({
            data: {
                userId: user.did,
                monthStart,
                monthEnd,
                wasActive: active,
                value: active ? value : 0,
            }
        })
    }
    console.log("Finished creating user months.")
}


async function recomputeMonthsIsActive(ctx: AppContext) {
    const months = await ctx.kysely
        .selectFrom("UserMonth")
        .select([
            "UserMonth.id",
            "UserMonth.monthStart",
            "UserMonth.monthEnd",
            eb => eb
                .selectFrom("ReadSession")
                .whereRef("UserMonth.monthStart", "<", "ReadSession.created_at")
                .whereRef("UserMonth.monthEnd", ">", "ReadSession.created_at")
                .whereRef("ReadSession.userId", "=", "UserMonth.userId")
                .select(eb => eb.fn.count<number>("ReadSession.id").as("readSessionsCount")).as("readSessionsCount")
        ])
        .where("UserMonth.wasActive", "=", false)
        .execute()

    const values = months
        .filter(m => m.readSessionsCount && m.readSessionsCount > 0)
        .map(m => ({
            id: m.id,
            wasActive: true,
            value: 0,
            monthStart: new Date(),
            monthEnd: new Date(),
            userId: ""
        }))

    if(values.length > 0){
        await ctx.kysely
            .insertInto("UserMonth")
            .values(values)
            .onConflict(oc => oc.column("id").doUpdateSet(eb => ({
                wasActive: eb => eb.ref("excluded.wasActive")
            })))
            .execute()
    }
}