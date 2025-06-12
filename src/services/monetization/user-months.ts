import {AppContext} from "#/index";
import {getMonthlyValue} from "#/services/monetization/donations";
import {getDidFromUri} from "#/utils/uri";
import {count} from "#/utils/arrays";
import { JsonValue } from "@prisma/client/runtime/library";
import {ReadChunks} from "#/services/monetization/read-tracking";

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

function countReadChunks(a: ReadChunks): number {
    return count(a, x => x.duration >= 25)
}

export function getChunksReadByContent(readSessions: {readContentId: string, readChunks: ReadChunks}[]){
    const chunksByContent = new Map<string, ReadChunks[]>()
    readSessions.forEach(readSession => {
        const k = readSession.readContentId
        chunksByContent.set(k, [...chunksByContent.get(k) ?? [], readSession.readChunks])
    })

    function joinManyChunks(chunks: ReadChunks[]): ReadChunks {
        return chunks.reduce((acc, c) => joinReadChunks(acc, c))
    }

    const chunksAccByContent = new Map<string, ReadChunks>(Array.from(chunksByContent.entries()).map(([k, v]) => [k, joinManyChunks(v)]))

    const chunksReadArray: [string, number][] = Array.from(chunksAccByContent.entries()).map(([k, v]) => ([k, countReadChunks(v)]))

    return new Map<string, number>(chunksReadArray)
}


function isActive(readSessions: {readContentId: string, readChunks: ReadChunks}[]){
    const m = getChunksReadByContent(readSessions)
    const authors = new Set<string>
    m.entries().forEach(([uri, readCount]) => {
        if(readCount > 0){
            authors.add(getDidFromUri(uri))
        }
    })
    return authors.size >= 3
}


function validateReadChunks(readChunks: JsonValue): { success: true; readChunks: ReadChunks } | { success: false } {
    if (!Array.isArray(readChunks)) return { success: false }

    for (const item of readChunks) {
        if (
            typeof item !== 'object' ||
            item === null ||
            Array.isArray(item) ||
            typeof (item as any).chunk !== 'number' ||
            typeof (item as any).duration !== 'number'
        ) {
            return { success: false }
        }
    }

    return { success: true, readChunks: readChunks as ReadChunks }
}


export function getValidatedReadSessions(readSessions: {readChunks: JsonValue, readContentId: string, createdAt: Date}[]): {readChunks: ReadChunks, createdAt: Date, readContentId: string}[] {
    const validatedReadSessions: {readChunks: ReadChunks, createdAt: Date, readContentId: string}[] = []
    readSessions.forEach(session => {
        const v = validateReadChunks(session.readChunks)
        if(v.success){
            validatedReadSessions.push({
                ...session,
                readChunks: v.readChunks,
            })
        }
    })
    return validatedReadSessions
}


export async function createUserMonths(ctx: AppContext) {
    // Se crean UserMonths para todos los usuarios cuyo último user month haya terminado o que tengan readSesions pero no user months
    console.log("Creating user months...")

    let users = await ctx.db.user.findMany({
        select: {
            did: true,
            handle: true,
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
                        gt: new Date(Date.now()-30*24*3600*1000)
                    }
                }
            }
        },
        where: {
            inCA: true,
            hasAccess: true,
        }
    })
    console.log(`Got ${users.length} users.`)

    function getNextMonthStart(user: {months: {monthStart: Date, monthEnd: Date}[], readSessions: {createdAt: Date}[]}){
        if(user.months.length == 0){
            if(user.readSessions.length > 0){
                return user.readSessions[0].createdAt
            } else {
                return null
            }
        } else {
            return user.months[0].monthEnd
        }
    }

    console.log("Getting monthly value")

    const value = getMonthlyValue()

    for(let user of users){
        console.log(`Evaluating user ${user.handle}`)
        const monthStart = getNextMonthStart(user)
        if(!monthStart || monthStart > new Date()) {
            console.log(`Skipping user ${user.handle}.`)
            continue
        }

        const monthEnd = new Date(monthStart.getTime() + 30*24*3600*1000)

        const readSessions = user.readSessions.filter(s => monthStart <= s.createdAt && monthEnd >= s.createdAt)

        const validatedReadSessions = getValidatedReadSessions(readSessions)
        const active = isActive(validatedReadSessions)

        console.log(`Creating user month (${monthStart}, ${monthEnd}) for ${user.handle}`)
        await ctx.db.userMonth.create({
            data: {
                userId: user.did,
                monthStart,
                monthEnd,
                wasActive: active,
                value: value,
            }
        })
    }
    console.log("Finished creating user months.")
}