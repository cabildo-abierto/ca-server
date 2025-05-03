import {updateCategoriesGraph} from "#/services/topic/graph";
import { Worker } from 'bullmq';
import {AppContext} from "#/index";
import {syncUser} from "#/services/sync/sync-user";
import {dbHandleToDid} from "#/services/user/users";


export function createWorker(ctx: AppContext){
    return new Worker(
        'bgJobs',
        async (job) => {
            if (job.name == 'update-categories-graph') {
                await updateCategoriesGraph(ctx);
            } else if(job.name == "sync-user"){
                const {handleOrDid, collectionsMustUpdate} = job.data as {handleOrDid: string, collectionsMustUpdate?: string[]}
                const did = await dbHandleToDid(ctx, handleOrDid)
                if(did){
                    await syncUser(ctx, did, collectionsMustUpdate, 1)
                } else {
                    console.log("User not found in DB: ", handleOrDid)
                }
            } else {
                console.log("No handler for job:", job.name)
            }
        },
        {connection: ctx.ioredis}
    )
}