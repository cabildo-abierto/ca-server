import {MirrorMachine} from "#/services/sync/mirror-machine.js";
import 'dotenv/config'
import {setupAppContext} from "#/setup.js";
import {Role} from "#/index.js";


export const run = async (roles: Role[]) => {
    const {ctx} = await setupAppContext(roles)

    if(roles.includes("mirror")){
        const ingester = new MirrorMachine(ctx)
        await ingester.run()
    }
}
