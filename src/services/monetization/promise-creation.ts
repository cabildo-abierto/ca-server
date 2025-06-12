import {AppContext} from "#/index";
import {getChunksReadByContent, getValidatedReadSessions} from "#/services/monetization/user-months";
import {sum} from "#/utils/arrays";
import {getMonthlyValue} from "#/services/monetization/donations";
import {getCollectionFromUri, isArticle, splitUri} from "#/utils/uri";
import {getTopicIdFromTopicVersionUri, isVersionAccepted, isVersionMonetized} from "#/services/wiki/current-version";
import {getTopicHistory} from "#/services/wiki/history";


export async function createPaymentPromises(ctx: AppContext) {
    // tomamos todos los meses de usuarios activos terminados que no tengan payment promises y creamos las promesas correspondientes

    let months = await ctx.db.userMonth.findMany({
        select: {
            id: true,
            user: {
                select: {
                    did: true,
                    handle: true
                }
            },
            monthStart: true,
            monthEnd: true,
        },
        where: {
            wasActive: true,
            promisesCreated: false
        }
    })

    const value = getMonthlyValue()

    for(let i = 0; i < months.length; i++){
        const m = months[i]
        if(m.monthEnd > new Date()) {
            continue
        }
        console.log("Creating payment promises for month", months[i].monthStart, "of user", m.user.handle)

        const readSessions = await ctx.db.readSession.findMany({
            select: {
                readContentId: true,
                readChunks: true,
                createdAt: true
            },
            where: {
                userId: m.user.did,
                createdAt: {
                    gte: m.monthStart,
                    lte: m.monthEnd
                }
            }
        })

        const validatedReadSessions = getValidatedReadSessions(readSessions)
        const chunksRead = getChunksReadByContent(validatedReadSessions)
        const totalChunksRead = sum(Array.from(chunksRead.values()), x => x)
        const chunkValue = value / totalChunksRead

        const contents = Array.from(chunksRead.entries())
        for(let i = 0; i < contents.length; i++){
            const [uri, chunks] = contents[i]
            await createPaymentPromisesForContent(ctx, uri, chunks * chunkValue, m.id)
        }
    }
}


async function createPaymentPromisesForContent(ctx: AppContext, uri: string, value: number, monthId: string){
    const collection = getCollectionFromUri(uri)
    if(isArticle(collection)){
        await ctx.db.paymentPromise.create({
            data: {
                userMonthId: monthId,
                amount: value,
                contentId: uri
            }
        })
    } else {
        const {did, rkey} = splitUri(uri)
        const id = await getTopicIdFromTopicVersionUri(ctx.db, did, rkey)
        if(!id){
            throw Error(`No se encontró el tema asociado a ${uri}`)
        }
        const history = await getTopicHistory(ctx.db, id)
        const idx = history.versions.findIndex(v => v.uri == uri)
        if(idx == -1){
            throw Error(`No se encontró la versión en el tema ${uri} ${id}`)
        }
        let monetizedCharsTotal = 0
        const authorsVersionsCount = new Map<string, number>()
        for(let i = 0; i <= idx; i++){
            const v = history.versions[i]
            if(v.addedChars == undefined){
                throw Error(`Diff sin calcular para la versión ${uri}`)
            }
            if(isVersionMonetized(v)){
                monetizedCharsTotal += v.addedChars
            }
            if(isVersionAccepted(v.status)){
                authorsVersionsCount.set(v.author.did, (authorsVersionsCount.get(v.author.did) ?? 0) + 1)
            }
        }
        for(let i = 0; i <= idx; i++){
            const v = history.versions[i]
            if(v.addedChars == undefined){
                throw Error(`Diff sin calcular para la versión ${uri}`)
            }
            let weight = 0
            if(isVersionMonetized(v)){
                weight += v.addedChars / monetizedCharsTotal * 0.9
            }
            if(isVersionAccepted(v.status)){
                weight += 1 / (idx+1) * 0.1
            }
            await ctx.db.paymentPromise.create({
                data: {
                    userMonthId: monthId,
                    amount: value * weight,
                    contentId: uri
                }
            })
        }
    }
}