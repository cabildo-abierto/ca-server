import {updateCategoriesGraph} from "#/services/topic/graph";
import {delay, Worker} from 'bullmq';
import {AppContext} from "#/index";
import {syncUser} from "#/services/sync/sync-user";
import {dbHandleToDid} from "#/services/user/users";
import {updateReferences} from "#/services/topic/references";
import {updateEngagementCounts} from "#/services/feed/getUserEngagement";
import {deleteCollection} from "#/services/delete";


export function createWorker(ctx: AppContext){
    return new Worker(
        'bgJobs',
        async (job) => {
            console.log("Got job:", job.name)
            if (job.name == 'update-categories-graph') {
                await updateCategoriesGraph(ctx);
            } else if(job.name == "sync-user") {
                const {handleOrDid, collectionsMustUpdate} = job.data as {
                    handleOrDid: string,
                    collectionsMustUpdate?: string[]
                }
                const did = await dbHandleToDid(ctx, handleOrDid)
                if (did) {
                    await syncUser(ctx, did, collectionsMustUpdate, 1)
                } else {
                    console.log("User not found in DB: ", handleOrDid)
                }
            } else if(job.name == "update-references") {
                await updateReferences(ctx)
            } else if(job.name == "update-engagement-counts") {
                await updateEngagementCounts(ctx)
            } else if(job.name == "delete-collection"){
                await deleteCollection(ctx, (job.data as {collection: string}).collection)
            } else {
                console.log("No handler for job:", job.name)
            }
        },
        {
            connection: ctx.ioredis,
            lockDuration: 60 * 1000 * 60 * 6
        }
    )
}


export async function addRepeatingJob(ctx: AppContext, name: string, every: number, delay: number){
    await ctx.queue.add(
        name,
        {},
        {
            repeat: {
                every: every
            },
            jobId: `${name}-repeating`,
            delay: delay,
            removeOnComplete: true,
            removeOnFail: true,
        }
    )
}

const mins = 60*1000

export async function setupWorker(ctx: AppContext){
    createWorker(ctx)

    // Jobs
    await addRepeatingJob(ctx, "update-references", 60*24*mins, 60*mins)
    await addRepeatingJob(ctx, "update-categories-graph", 60*24*mins, 2*60*mins)

    // Logs
    const waitingJobs = await ctx.queue.getJobs(['waiting'])
    const delayedJobs = await ctx.queue.getJobs(['delayed'])

    console.log("Waiting jobs:", waitingJobs.length)
    waitingJobs.forEach((job) => {console.log(job.id, job.name)})
    console.log("Delayed jobs:", delayedJobs.length)
    delayedJobs.forEach((job) => {console.log(job.id, job.name)})
}