import {CAHandler} from "#/utils/handler";
import MercadoPagoConfig, {Preference} from "mercadopago";
import {SessionAgent} from "#/utils/session-agent";
import {AppContext} from "#/index";

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


export const createPreference: CAHandler<{amount: number}, {id: string}> = async (ctx, agent, {amount}) => {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! })
    const preference = new Preference(client)

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
