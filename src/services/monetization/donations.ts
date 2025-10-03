import {CAHandler, CAHandlerNoAuth} from "#/utils/handler";
import MercadoPagoConfig, {Preference} from "mercadopago";
import {AppContext} from "#/setup";
import {getUsersWithReadSessions, UserWithReadSessions} from "#/services/monetization/user-months";
import {count, max} from "#/utils/arrays";
import {v4 as uuidv4} from "uuid";
import {env} from "#/lib/env";

type Donation = {
    date: Date
    amount: number
}

export type DonationHistory = Donation[]

export const getDonationHistory: CAHandler<{}, DonationHistory> = async (ctx, agent, {}) => {
    const subscriptions = await ctx.kysely
        .selectFrom("Donation")
        .select(["created_at", "amount"])
        .where("userById", "=", agent.did)
        .where("transactionId", "is not", null)
        .execute()

    return {
        data: subscriptions.map(s => ({
            date: s.created_at,
            amount: s.amount
        }))
    }
}


export const getMonthlyValueHandler: CAHandlerNoAuth<{}, number> = async (ctx, agent, {}) => {
    return {data: getMonthlyValue()}
}


export function getMonthlyValue() {
    return 1500
}


export function isWeeklyActiveUser(ctx: AppContext, u: UserWithReadSessions, at: Date = new Date()): boolean {
    const lastWeekStart = new Date(at.getTime() - 1000 * 3600 * 24 * 7)
    ctx.logger.pino.info({
        lastWeekStart,
        handle: u.handle,
        sess: max(u.readSessions.map(r => r.created_at), x => new Date(x).getTime())
    }, "isWA?")
    const recentSessions = u.readSessions
        .filter(x => new Date(x.created_at) > lastWeekStart && new Date(x.created_at) < at)

    return recentSessions.length > 0
}


export function isMonthlyActiveUser(u: UserWithReadSessions, at: Date = new Date()): boolean {
    const lastMonthStart = new Date(at.getTime() - 1000 * 3600 * 24 * 30)
    const recentSessions = u.readSessions
        .filter(x => x.created_at > lastMonthStart && x.created_at < at)
    return recentSessions.length > 0
}


export async function getMonthlyActiveUsers(ctx: AppContext) {
    // Se consideran usuarios activos todos los usuarios que:
    //  - Sean cuenta de persona verificada
    //  - Hayan tenido al menos una read session en la última semana
    const users = await getUsersWithReadSessions(ctx)
    return count(users, isMonthlyActiveUser)
}

export async function getGrossIncome(ctx: AppContext): Promise<number> {
    const result = await ctx.kysely
        .selectFrom("Donation")
        .where("Donation.transactionId", "is not", null)
        .select((eb) => eb.fn.sum<number>("amount").as("total"))
        .executeTakeFirstOrThrow()

    return result.total
}

export async function getTotalSpending(ctx: AppContext): Promise<number> {
    const result = await ctx.kysely
        .selectFrom("UserMonth")
        .select((eb) => eb.fn.sum<number>("value").as("total"))
        .where("UserMonth.wasActive", "=", true)
        .executeTakeFirstOrThrow()

    return result.total ?? 0
}


export const getFundingStateHandler: CAHandlerNoAuth<{}, number> = async (ctx, agent, {}) => {
    const [mau, grossIncome, incomeSpent] = await Promise.all([
        getMonthlyActiveUsers(ctx),
        getGrossIncome(ctx),
        getTotalSpending(ctx)
    ])
    const monthlyValue = getMonthlyValue()
    const months = 6

    const state = Math.max(Math.min((grossIncome - incomeSpent) / (mau * monthlyValue * months), 1), 0) * 100
    ctx.logger.pino.info({monthlyValue, mau, grossIncome, incomeSpent, months, state}, "funding state")

    return {data: state}
}


export const createPreference: CAHandlerNoAuth<{ amount: number }, { id: string }> = async (ctx, agent, {amount}) => {
    const client = new MercadoPagoConfig({accessToken: env.MP_ACCESS_TOKEN!})
    const preference = new Preference(client)

    const title = "Aporte de $" + amount + " a Cabildo Abierto"

    const frontendUrl = "https://cabildoabierto.ar"

    let items = [{
        picture_url: `${frontendUrl}/logo.png`,
        id: "0",
        title: title,
        quantity: 1,
        unit_price: amount,
        currencyId: "ARS"
    }]

    const agentDid = agent.hasSession() ? agent.did : "anonymous"

    try {
        const result = await preference.create({
            body: {
                back_urls: {
                    success: frontendUrl + "/aportar/pago-exitoso",
                    pending: frontendUrl + "/aportar/pago-pendiente",
                    failure: frontendUrl + "/aportar/pago-fallido"
                },
                notification_url: frontendUrl + "/api/pago?source_news=webhooks",
                items: items,
                metadata: {
                    user_id: agentDid,
                    amount: amount,
                },
                payment_methods: {
                    excluded_payment_types: [
                        {id: "ticket"}
                    ]
                }
            }
        })
        if (!result.id) {
            console.log("No id", result)
            return {error: "Ocurrió un error al iniciar el pago."}
        } else {
            await ctx.kysely
                .insertInto("Donation")
                .values([{
                    id: uuidv4(),
                    created_at: new Date(),
                    userById: agent.hasSession() ? agentDid : undefined,
                    amount: amount,
                    mpPreferenceId: result.id
                }])
                .execute()

            return {data: {id: result.id}}
        }
    } catch (err) {
        console.log("Error al crear una preferencia.", err)
        return {error: "Ocurrió un error al iniciar el pago."}
    }
}


const getPaymentDetails = async (orderId: string) => {
    const url = `https://api.mercadopago.com/merchant_orders/${orderId}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${env.MP_ACCESS_TOKEN!}`,
        },
    });

    const body = await response.json()
    console.log(`order ${orderId} resulted in body`, body)
    const payments = body.payments
    if (payments && payments.length > 0) {
        const payment = payments[0]
        const id = payment.id
        const amount = payment.transaction_amount
        const preference_id = body.preference_id
        return {paymentId: id, amount, paymentStatus: payment.status, preferenceId: preference_id}
    } else {
        throw Error("Couldn't find payments in order")
    }
}

type MPNotificationBody = {
    action: string
    api_version: string
    data: {
        id?: string
    }
    date_created: string
    id: string
    live_mode: boolean
    type: string
    user_id: string
    params: any
    query: { "data.id": string }
}

export const processPayment: CAHandlerNoAuth<MPNotificationBody, {}> = async (ctx, agent, body) => {
    console.log("processing payment notification with body", body)
    let orderId = body.id
    if (!orderId) {
        console.log("No order id", orderId)
        return {error: "Ocurrió un error al procesar el identificador de la transacción."}
    }
    console.log("getting payment details with order id", orderId)
    const paymentDetails = await getPaymentDetails(orderId)
    console.log("got payment details", paymentDetails)

    if (paymentDetails.paymentStatus != "approved") {
        console.log("status was", paymentDetails.paymentStatus)
        return {error: "El pago no fue aprobado."}
    }

    const preferenceId = paymentDetails.preferenceId
    console.log("got preference id", preferenceId)

    const donationId = await ctx.kysely
        .selectFrom("Donation")
        .select("id")
        .where("mpPreferenceId", "=", preferenceId)
        .execute()

    if (donationId.length > 0) {
        const id = donationId[0].id
        console.log("found donation", id)

        await ctx.kysely
            .updateTable("Donation")
            .set("transactionId", paymentDetails.paymentId as string)
            .where("id", "=", id)
            .execute()

    } else {
        console.log(`Couldn't find donation for preference ${preferenceId} in db.`)
        return {error: `Couldn't find donation for preference ${preferenceId} in db.`}
    }

    return {}
}
