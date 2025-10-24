import {AppContext} from "#/setup.js";
import {getChunksReadByContent} from "#/services/monetization/user-months.js";
import {sum} from "#/utils/arrays.js";
import {getMonthlyValue} from "#/services/monetization/donations.js";
import {getCollectionFromUri, isArticle, isTopicVersion, splitUri} from "#/utils/uri.js";
import {getTopicIdFromTopicVersionUri} from "#/services/wiki/current-version.js";
import {getTopicHistory} from "#/services/wiki/history.js";
import {ReadChunksAttr} from "#/services/monetization/read-tracking.js";
import {v4 as uuidv4} from "uuid";


type ReadSessionData = {
    readContentId: string | null
    readChunks: ReadChunksAttr
}


function getPaymentPromisesForArticles(ctx: AppContext, value: number, readSessions: ReadSessionData[], monthId: string): PaymentPromiseCreation[] {
    const articleReads = readSessions
        .filter(x => x.readContentId && isArticle(getCollectionFromUri(x.readContentId)))

    const chunksRead = getChunksReadByContent(articleReads)
    const totalChunksRead = sum(Array.from(chunksRead.values()), x => x)

    const promises: PaymentPromiseCreation[] = []
    if (totalChunksRead > 0) {
        const chunkValue = value / totalChunksRead

        const contents = Array.from(chunksRead.entries())
        for (let i = 0; i < contents.length; i++) {
            const [uri, chunks] = contents[i]
            ctx.logger.pino.info({uri}, "new payment promise for article")
            const promiseValue = chunks * chunkValue
            promises.push({
                id: uuidv4(),
                userMonthId: monthId,
                amount: promiseValue,
                contentId: uri
            })
        }
    }
    return promises
}


async function createPaymentPromisesForTopicVersions(ctx: AppContext, value: number, readSessions: ReadSessionData[], monthId: string): Promise<PaymentPromiseCreation[]> {
    const tvReads = readSessions
        .filter(x => x.readContentId && isTopicVersion(getCollectionFromUri(x.readContentId)))

    const chunksRead = getChunksReadByContent(tvReads)
    const totalChunksRead = sum(Array.from(chunksRead.values()), x => x)

    const promises = new Map<string, PaymentPromiseCreation>()
    if (totalChunksRead > 0) {
        const chunkValue = value / totalChunksRead

        const contents = Array.from(chunksRead.entries())
        for (let i = 0; i < contents.length; i++) {
            const [uri, chunks] = contents[i]
            ctx.logger.pino.info({uri}, "new payment promise for topic")
            const promiseValue = chunks * chunkValue
            const tvPromises = await createPaymentPromisesForTopicVersion(ctx, uri, promiseValue, monthId)

            tvPromises.forEach(p => {
                const key = `${p.userMonthId}:${p.contentId}`
                const cur = promises.get(key)
                if(!cur){
                    promises.set(key, p)
                } else {
                    // unificamos promesas del mismo mes-usuario-contenido
                    promises.set(key, {
                        ...cur,
                        amount: cur.amount + p.amount
                    })
                }
            })
        }
    }
    return Array.from(promises.values())
}


export async function createPaymentPromises(ctx: AppContext) {
    ctx.logger.pino.info("creating payment promises")
    let months: {id: string, did: string, handle: string | null, monthStart: Date, monthEnd: Date, paymentPromises: number | null}[] = []
    try {
        months = await ctx.kysely
            .selectFrom("UserMonth")
            .innerJoin("User", "User.did", "UserMonth.userId")
            .select([
                "UserMonth.id",
                "User.did",
                "User.handle",
                "UserMonth.monthStart",
                "UserMonth.monthEnd",
                eb => eb
                    .selectFrom("PaymentPromise")
                    .whereRef("PaymentPromise.userMonthId", "=", "UserMonth.id")
                    .select(eb.fn.countAll<number>().as("count"))
                    .as("paymentPromises")
            ])
            .where("wasActive", "=", true)
            .where("promisesCreated", "=", false)
            .execute()
    } catch (error) {
        ctx.logger.pino.error({error}, "error getting users months")
        return
    }

    months = months.filter(m => m.paymentPromises == 0)

    const value = getMonthlyValue()

    ctx.logger.pino.info({months: months.length, value: value}, "got months for payment promises")

    const promises: PaymentPromiseCreation[] = []
    for (let i = 0; i < months.length; i++) {
        const m = months[i]
        if (m.monthEnd > new Date()) {
            continue
        }
        ctx.logger.pino.info({month: months[i].monthStart, handle: m.handle}, "creating payment promises for month")

        let validatedReadSessions: ReadSessionData[] = []
        try {
            const readSessions = await ctx.kysely
                .selectFrom("ReadSession")
                .select(["readContentId", "readChunks"])
                .leftJoin("Record", "Record.uri", "readContentId")
                .where("userId", "=", m.did)
                .where("ReadSession.created_at", ">", m.monthStart)
                .where("ReadSession.created_at", "<", m.monthEnd)
                .where("Record.authorId", "!=", m.did)
                .execute()

            validatedReadSessions = readSessions
                .map(r => ({
                    ...r,
                    readChunks: r.readChunks as ReadChunksAttr
                }))
        } catch (error) {
            ctx.logger.pino.error({error, m}, "error getting read sessions")
            return
        }

        const articlePromises = getPaymentPromisesForArticles(
            ctx,
            value * 0.7 * 0.5,
            validatedReadSessions,
            m.id
        )
        promises.push(...articlePromises)

        try {
            const topicVersionPromises = await createPaymentPromisesForTopicVersions(
                ctx,
                value * 0.7 * 0.5,
                validatedReadSessions,
                m.id
            )
            promises.push(...topicVersionPromises)
        } catch (error) {
            ctx.logger.pino.error({error, m}, "error creating topic version promises")
            return
        }
    }

    promises.forEach((p, index) => {
        if (promises.slice(0, index).some(p2 => p2.contentId == p.contentId && p2.userMonthId == p.userMonthId)) {
            console.log("Repeated promises!")
            ctx.logger.pino.warn(p, `repeated promises`)
        }
    })

    ctx.logger.pino.info({count: promises.length}, `inserting new payment promises`)

    if(promises.length > 0){
        await ctx.kysely
            .insertInto("PaymentPromise")
            .values(promises)
            .onConflict(oc => oc.columns(["userMonthId", "contentId"]).doNothing())
            .execute()
    }
}


type PaymentPromiseCreation = {
    id: string
    userMonthId: string
    amount: number
    contentId: string
}


async function createPaymentPromisesForTopicVersion(ctx: AppContext, uri: string, value: number, monthId: string): Promise<PaymentPromiseCreation[]> {
    const {did, rkey} = splitUri(uri)
    const id = await getTopicIdFromTopicVersionUri(ctx, did, rkey)
    if (!id) {
        ctx.logger.pino.error({uri}, "topic not found for uri")
        throw Error(`No se encontró el tema asociado a ${uri}`)
    }
    const history = await getTopicHistory(ctx, id)
    const idx = history.versions.findIndex(v => v.uri == uri)
    if (idx == -1) {
        ctx.logger.pino.error({uri, id}, "topic version not found")
        throw Error(`No se encontró la versión en el tema ${uri} ${id}`)
    }
    let monetizedCharsTotal = 0
    const authorsVersionsCount = new Map<string, number>()
    for (let i = 0; i <= idx; i++) {
        const v = history.versions[i]
        if (v.addedChars == undefined) {
            throw Error(`Diff sin calcular para la versión ${uri}`)
        }
        if (v.claimsAuthorship) {
            monetizedCharsTotal += v.addedChars
        }
        if (v.status.accepted) {
            authorsVersionsCount.set(v.author.did, (authorsVersionsCount.get(v.author.did) ?? 0) + 1)
        }
    }
    const promises: PaymentPromiseCreation[] = []
    for (let i = 0; i <= idx; i++) {
        const v = history.versions[i]
        if (v.addedChars == undefined) {
            ctx.logger.pino.error({uri}, "diff not computed")
            throw Error(`Diff sin calcular para la versión ${uri}`)
        }
        let weight = 0
        if (v.claimsAuthorship && monetizedCharsTotal > 0) {
            weight += v.addedChars / monetizedCharsTotal * 0.9
        }
        if (v.status.accepted) {
            weight += 1 / (idx + 1) * (monetizedCharsTotal > 0 ? 0.1 : 1.0)
        }
        ctx.logger.pino.info({uri, value, weight, amount: value * weight}, "payment promise for topic")

        promises.push({
            id: uuidv4(),
            userMonthId: monthId,
            amount: value * weight,
            contentId: uri
        })
    }
    return promises
}