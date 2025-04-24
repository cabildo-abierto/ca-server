import {AppContext} from "#/index";

export const addView = async (ctx: AppContext, uri: string, did: string) => {
    try {
        const exists = await ctx.db.view.findMany({
            select: {
                createdAt: true
            },
            where: {
                AND: [{
                    userById: did
                },{
                    recordId: uri
                }]
            },
            orderBy: {
                createdAt: "asc"
            }
        })
        function olderThan(seconds: number){
            const dateLast = new Date(exists[exists.length-1].createdAt).getTime()
            const currentDate = new Date().getTime()
            const difference = (currentDate - dateLast) / 1000
            return difference > seconds
        }

        if(exists.length == 0 || olderThan(3600)){

            try {
                await ctx.db.view.create({
                    data: {
                        userById: did,
                        recordId: uri
                    },
                })
            } catch {
                return {error: "Ocurrió un error"}
            }
        }

        return {}
    } catch {
        return {error: "Ocurrió un error."}
    }

}