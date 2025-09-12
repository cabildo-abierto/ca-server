import {AppContext} from "#/setup";


export async function updatePayments(ctx: AppContext) {
    /***
     Pasan a confirmados los pagos cuyos contenidos hayan sido creados hace más de 30 días
     ***/
    const oneMonthAgo = new Date(Date.now() - 30*24*3600*1000)
    const promises = await ctx.db.paymentPromise.findMany({
        select: {
            id: true,
            content: {
                select: {
                    uri: true,
                    record: {
                        select: {
                            createdAt: true
                        }
                    }
                }
            }
        },
        where: {
            status: "Pending"
        }
    })
    for(let i = 0; i < promises.length; i++){
        const p = promises[i]
        if(p.content.record.createdAt < oneMonthAgo){
            await ctx.db.paymentPromise.update({
                data: {
                    status: "Confirmed"
                },
                where: {
                    id: p.id
                }
            })
        }
    }
}