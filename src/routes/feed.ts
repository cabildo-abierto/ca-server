import {AppContext} from "#/index";


export const feedRoutes = (ctx: AppContext) => {

    ctx.xrpc.ar.cabildoabierto.feed.getFeed({
        handler: ({auth, params, input, req, res}) => {
            return { encoding: 'application/json', body: { feed: [] } }
        }
    })
}