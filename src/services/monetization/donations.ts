import {CAHandler} from "#/utils/handler";
import MercadoPagoConfig, {Preference} from "mercadopago";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {getUsersWithReadSessions} from "#/services/monetization/user-months";
import {count} from "#/utils/arrays";

type Donation = {
    date: Date
    amount: number
}

export type DonationHistory = Donation[]

export const getDonationHistory: CAHandler<{}, DonationHistory> = async (ctx, agent, {}) => {
    const subscriptions = await ctx.db.donation.findMany({
        where: {
            userById: agent.did
        }
    })

    return {data: subscriptions.map(s => ({
        date: s.createdAt,
        amount: s.amount
    }))}
}


export const getMonthlyValueHandler: CAHandler<{}, number> = async (ctx, agent, {}) => {
    return {data: getMonthlyValue()}
}


export function getMonthlyValue() {
    return 1200
}


export function isWeeklyActiveUser(u: {handle: string, readSessions: {createdAt: Date, readContentId: string | null}[]}, at: Date = new Date()): boolean {
    const lastWeekStart = new Date(at.getTime() - 1000*3600*24*7)
    const recentSessions = u.readSessions
        .filter(x => x.createdAt > lastWeekStart && x.createdAt < at)
    if(recentSessions.length > 0){
        console.log("user", u.handle, "is active at", at)
    }
    return recentSessions.length > 0
}


export async function getMonthlyActiveUsers(ctx: AppContext) {
    // Se consideran usuarios activos todos los usuarios que:
    //  - Sean cuenta de persona verificada
    //  - Hayan tenido al menos una read session en la última semana
    const users = await getUsersWithReadSessions(ctx)
    return count(users, isWeeklyActiveUser)
}

export async function getGrossIncome(ctx: AppContext): Promise<number> {
    const result = await ctx.kysely
        .selectFrom("Donation")
        .select((eb) => eb.fn.sum<number>("amount").as("total"))
        .executeTakeFirstOrThrow()

    return result.total
}

export async function getTotalSpending(ctx: AppContext): Promise<number> {
    const result = await ctx.kysely
        .selectFrom("UserMonth")
        .select((eb) => eb.fn.sum<number>("value").as("total"))
        .executeTakeFirstOrThrow()

    return result.total
}


export const getFundingStateHandler: CAHandler<{}, number> = async (ctx, agent, {}) => {
    const [mau, grossIncome, incomeSpent] = await Promise.all([
        getMonthlyActiveUsers(ctx),
        getGrossIncome(ctx),
        getTotalSpending(ctx)
    ])
    const monthlyValue = getMonthlyValue()

    const months = 6

    const state = Math.max(Math.min((grossIncome - incomeSpent) / (mau * monthlyValue * months), 1), 0) * 100

    return {data: state}
}


export const createPreference: CAHandler<{amount: number}, {id: string}> = async (ctx, agent, {amount}) => {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! })
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

    try {
        const result = await preference.create({
            body: {
                back_urls: {
                    success: frontendUrl+"/aportar/pago-exitoso",
                    pending: frontendUrl+"/aportar/pago-pendiente",
                    failure: frontendUrl+"/aportar/pago-fallido"
                },
                notification_url: frontendUrl+"/api/pago?source_news=webhooks",
                items: items,
                metadata: {
                    user_id: agent.did,
                    amount: amount,
                },
                payment_methods: {
                    excluded_payment_types: [
                        {id: "ticket"}
                    ]
                }
            }
        })
        if(!result.id){
            console.log("No id", result)
            return {error: "Ocurrió un error al iniciar el pago."}
        } else {
            return {data: {id: result.id}}
        }
    } catch (err) {
        console.log("Error al crear una preferencia.", err)
        return {error: "Ocurrió un error al iniciar el pago."}
    }
}


const getPaymentDetails = async (paymentId: string) => {
    const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN!}`,
        },
    });

    return await response.json();
};


export async function createDonation(ctx: AppContext, agent: SessionAgent, amount: number, paymentId: string) {
    try {
        await ctx.db.donation.create({
            data: {
                userById: agent.did,
                transactionId: paymentId,
                amount
            }
        })
    } catch {
        return {error: "error on buy subscriptions"}
    }

    return {}
}


export const processPayment: CAHandler<{data: any}, {}> = async (ctx, agent, params) => {
    const data = params.data
    const paymentId = data.id

    const paymentDetails = await getPaymentDetails(paymentId)

    if(paymentDetails.status != "approved"){
        return {error: "El pago no fue aprobado."}
    }

    const donationAmount = paymentDetails.metadata.amount
    const userId = paymentDetails.metadata.user_id

    const {error} = await createDonation(ctx, agent, donationAmount, paymentId)

    if(error) {
        console.log("error", error)
        console.log("details", paymentDetails)
        console.log(userId, donationAmount, paymentId)
        return {error: "Ocurrió un error al procesar un pago."}
    }

    return {}
}
