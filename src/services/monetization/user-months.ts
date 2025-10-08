import {AppContext} from "#/setup.js";
import {getMonthlyValue} from "#/services/monetization/donations.js";
import {getDidFromUri} from "#/utils/uri.js";
import {sum} from "#/utils/arrays.js";
import {ReadChunks, ReadChunksAttr} from "#/services/monetization/read-tracking.js";
import {jsonArrayFrom} from "kysely/helpers/postgres";
import {v4 as uuidv4} from "uuid";

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


export type UserWithReadSessions = {
    did: string
    handle: string
    months: {
        monthStart: Date
        monthEnd: Date
    }[]
    readSessions: {
        readContentId: string | null,
        readChunks: unknown
        created_at: Date
    }[]
}


export async function getUsersWithReadSessions(
    ctx: AppContext,
    after: Date = new Date(Date.now() - 60 * 24 * 3600 * 1000),
    verified: boolean = true
): Promise<UserWithReadSessions[]> {
    try {
        const users = await ctx.kysely
            .selectFrom("User")
            .select([
                "did",
                "handle",
                "userValidationHash",
                eb => jsonArrayFrom(eb
                    .selectFrom("UserMonth")
                    .whereRef("UserMonth.userId", "=", "User.did")
                    .select([
                        "monthStart",
                        "monthEnd"
                    ])
                    .orderBy("monthStart desc")
                ).as("months"),
                eb => jsonArrayFrom(eb
                    .selectFrom("ReadSession")
                    .whereRef("ReadSession.userId", "=", "User.did")
                    .select([
                        "readContentId",
                        "created_at",
                        "readChunks"
                    ])
                    .where("created_at", ">", after)
                    .orderBy("created_at asc")
                ).as("readSessions")
            ])
            .where("User.inCA", "=", true)
            .where("User.hasAccess", "=", true)
            .$if(verified, qb => qb.where("User.userValidationHash", "is not", null))
            .execute()

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
    } catch (err) {
        ctx.logger.pino.error({error: err}, "error getting users with read sessions")
        throw err
    }
}


// el siguiente mes empieza en el momento en el que terminó el último
export function getNextMonthStart(user: UserWithReadSessions) {
    if (user.months.length == 0) {
        if (user.readSessions.length > 0) {
            return new Date(user.readSessions[0].created_at)
        } else {
            return null
        }
    } else {
        return new Date(user.months[0].monthEnd)
    }
}


async function createMonthForUser(ctx: AppContext, user: UserWithReadSessions, value: number) {
    const monthStart = getNextMonthStart(user)
    if (!monthStart) {
        ctx.logger.pino.info({handle: user.handle}, `todavía no empezó el primer mes.`)
        return
    }

    if (monthStart > new Date()) {
        ctx.logger.pino.info({handle: user.handle}, `tiene un mes asignado que no terminó. Revisar, no debería pasar.`)
        return
    }

    const monthEnd = new Date(monthStart.getTime() + 30 * 24 * 3600 * 1000)

    if (monthEnd > new Date()) {
        ctx.logger.pino.info({handle: user.handle}, `skipeado, todavía no terminó el nuevo mes`)
        return
    }

    const readSessions = user.readSessions.filter(s => monthStart <= s.created_at && monthEnd >= s.created_at)

    const validatedReadSessions = readSessions.map(r => ({
        ...r,
        readChunks: r.readChunks as ReadChunksAttr
    }))
    const active = isActive(validatedReadSessions)

    ctx.logger.pino.info({monthStart, monthEnd, handle: user.handle}, `creating user month`)
    await ctx.kysely
        .insertInto("UserMonth")
        .values([{
            id: uuidv4(),
            userId: user.did,
            monthStart,
            monthEnd,
            monthStart_tz: monthStart,
            monthEnd_tz: monthEnd,
            wasActive: active,
            value: active ? value : 0,
        }])
        .execute()
}


export async function createUserMonths(ctx: AppContext) {
    // Se crean UserMonths para todos los usuarios cuyo último user month haya terminado o que tengan readSesions pero no user months
    ctx.logger.pino.info("creating user months")

    let users = await getUsersWithReadSessions(ctx)
    ctx.logger.pino.info(`got ${users.length} users with read sessions`)

    const value = getMonthlyValue()
    ctx.logger.pino.info({monthlyValue: value})

    for (let user of users) {
        try {
            await createMonthForUser(ctx, user, value)
        } catch (err) {
            if(err instanceof Error) {
                ctx.logger.pino.error(
                    {error: err.toString(), handle: user.handle},
                    "error creating month for user"
                )
            }
        }
    }
}


/*async function recomputeMonthsIsActive(ctx: AppContext) {
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
}*/