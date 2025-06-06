import {CAHandler} from "#/utils/handler";
import MercadoPagoConfig, {Preference} from "mercadopago";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";
import {range} from "#/utils/arrays";
import {v4 as uuidv4} from 'uuid'

type Donation = {
    date: Date
    amount: number
}

export type DonationHistory = Donation[]

export const getDonationHistory: CAHandler<{}, DonationHistory> = async (ctx, agent, {}) => {
    const subscriptions = await ctx.db.subscription.findMany({
        where: {
            userId: agent.did
        }
    })

    return {data: subscriptions.map(s => ({
        date: s.createdAt,
        amount: s.price
    }))}
}


export const getMonthlyValue: CAHandler<{}, number> = async (ctx, agent, {}) => {
    return {data: 800}
}


export const createPreference: CAHandler<{quantity: number, value: number}, {id: string}> = async (ctx, agent, {quantity, value}) => {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! })
    const preference = new Preference(client)

    const amount = quantity * value

    const title = "Aporte de $" + amount + " a Cabildo Abierto"

    const frontendUrl = "https://cabildoabierto.ar"

    let items = [{
        picture_url: "https://cabildoabierto.ar/logo.png",
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
                    donated_quantity: quantity,
                    item_value: value
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


export async function buySubscriptions(ctx: AppContext, agent: SessionAgent, quantity: number, value: number, paymentId: string) {
    const values: {
        id: string,
        boughtByUserId: string,
        price: number,
        paymentId: string,
        isDonation: boolean,
        userId: string | null,
        usedAt: Date | null,
        endsAt: Date | null
    }[] = range(quantity).map((d) => ({
        id: uuidv4(),
        boughtByUserId: agent.did,
        price: value,
        paymentId: paymentId,
        isDonation: true,
        userId: null,
        usedAt: null,
        endsAt: null
    }))

    try {
        await ctx.kysely
            .insertInto("Subscription")
            .values(values)
            .execute()
    } catch (e) {
        return {error: "error on buy subscriptions"}
    }

    return {}
}


export const processPayment: CAHandler<{data: any}, {}> = async (ctx, agent, params) => {
    const secret = process.env.MP_WEBHOOK_KEY!

    const data = params.data
    const paymentId = data.id

    const paymentDetails = await getPaymentDetails(paymentId)

    console.log("params", params)
    console.log("paymentDetails", paymentDetails)

    if(paymentDetails.status != "approved"){
        return {error: "El pago no fue aprobado."}
    }

    const donatedQuantity = paymentDetails.metadata.donated_quantity
    const itemValue = paymentDetails.metadata.item_value
    const userId = paymentDetails.metadata.user_id

    const {error} = await buySubscriptions(ctx, agent, donatedQuantity, itemValue, paymentId)

    if(error) {
        console.log("error", error)
        console.log("details", paymentDetails)
        console.log(userId, donatedQuantity, itemValue, paymentId)
        return {error: "Ocurrió un error al procesar un pago."}
    }

    return {}
}
