import {MirrorMachine} from "#/services/sync/mirror-machine";
import 'dotenv/config'
import {setupAppContext} from "#/setup";
import {Role} from "#/index";


export const run = async (roles: Role[]) => {
    const {ctx} = await setupAppContext(roles)

    if(roles.includes("mirror")){
        const ingester = new MirrorMachine(ctx)
        await ingester.run()
    }
}
