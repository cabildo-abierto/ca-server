import {updateCategoriesGraph} from "#/services/wiki/graph";
import {Worker} from 'bullmq';
import {AppContext} from "#/index";
import {syncAllUsers, syncUser} from "#/services/sync/sync-user";
import {dbHandleToDid} from "#/services/user/users";
import {updateReferences} from "#/services/wiki/references";
import {updateEngagementCounts} from "#/services/feed/getUserEngagement";
import {deleteCollection} from "#/services/delete";
import {updateTopicPopularityScores} from "#/services/wiki/popularity";
import {updateTopicsCategories} from "#/services/wiki/categories";
import {updateTopicContributions} from "#/services/wiki/contributions";
import {createUserMonths} from "#/services/monetization/user-months";
import {Queue} from "bullmq";
import Redis from "ioredis";
import {createNotificationJob, createNotificationsBatchJob} from "#/services/notifications/notifications";

const mins = 60 * 1000

type CAJobHandler<T> = (data: T) => Promise<void>

type CAJobDefinition<T> = {
    name: string
    handler: CAJobHandler<T>
}


export class CAWorker {
    worker: Worker
    ioredis: Redis
    queue: Queue
    jobs: CAJobDefinition<any>[] = []

    constructor(ioredis: Redis) {
        const env = process.env.NODE_ENV || "development"
        const queueName = `${env}-queue`
        const queuePrefix = undefined
        console.log(`Starting worker on queue ${queueName} with prefix ${queuePrefix}`)
        this.ioredis = ioredis
        this.queue = new Queue(queueName, {
            prefix: queuePrefix,
            connection: ioredis
        })
        this.worker = new Worker(queueName, async (job) => {
                console.log("got job!", job.name)
                for (let i = 0; i < this.jobs.length; i++) {
                    if (job.name.startsWith(this.jobs[i].name)) {
                        console.log(`Running job: ${job.name}.`)
                        await this.jobs[i].handler(job.data)
                        return
                    }
                }
                console.log("No handler for job:", job.name)
            },
            {
                connection: ioredis,
                lockDuration: 60 * 1000 * 5
            }
        )
        this.worker.on('failed', (job, err) => {
            console.error(`Job ${job?.name} failed:`, err);
        })
        this.worker.on('error', (err) => {
            console.error('Worker error:', err);
        })
        this.worker.on('active', (job) => {
            console.log(`Job ${job.name} started`);
        })
        this.worker.on('completed', (job) => {
            console.log(`Job ${job.name} completed`);
        })
    }

    setupJob(jobName: string, handler: (data: any) => Promise<void>) {
        this.jobs.push({name: jobName, handler})
    }

    async setup(ctx: AppContext) {
        this.setupJob( "update-categories-graph", () => updateCategoriesGraph(ctx))
        this.setupJob( "sync-user", async (data: any) => {
            const {handleOrDid, collectionsMustUpdate} = data as {
                handleOrDid: string,
                collectionsMustUpdate?: string[]
            }
            const did = await dbHandleToDid(ctx, handleOrDid)
            if (did) {
                await syncUser(ctx, did, collectionsMustUpdate, 1)
            } else {
                console.log("User not found in DB: ", handleOrDid)
            }
        })
        this.setupJob("update-references", () => updateReferences(ctx))
        this.setupJob( "update-engagement-counts", () => updateEngagementCounts(ctx))
        this.setupJob( "delete-collection", async (data) => {
            await deleteCollection(ctx, (data as { collection: string }).collection)
        })
        this.setupJob("update-topics-popularity", () => updateTopicPopularityScores(ctx))
        this.setupJob("sync-all-users", (data) => syncAllUsers(ctx, (data as { mustUpdateCollections: string[] }).mustUpdateCollections))
        this.setupJob("delete-collection", (data) => deleteCollection(ctx, (data as { collection: string }).collection))
        this.setupJob("update-topics-categories", () => updateTopicsCategories(ctx))
        this.setupJob("update-topic-contributions", (data) => updateTopicContributions(ctx, data as string[]))
        this.setupJob("create-user-months", () => createUserMonths(ctx))
        this.setupJob("create-notification", (data) => createNotificationJob(ctx, data))
        this.setupJob("batch-create-notifications", (data) => createNotificationsBatchJob(ctx, data))
        this.setupJob("batch-jobs", () => this.batchJobs())
        this.setupJob("test-job", async () => {console.log("Test job run!")})

        await this.removeAllRepeatingJobs()
        await this.addRepeatingJob("update-topics-popularity", 60 * 24 * mins, 60 * mins)
        await this.addRepeatingJob("update-topics-categories", 60 * 24 * mins, 60 * mins + 5)
        await this.addRepeatingJob("update-categories-graph", 60 * 24 * mins, 60 * mins + 7)
        await this.addRepeatingJob("update-references", 60 * 24 * mins, 60 * mins + 10)
        await this.addRepeatingJob("create-user-months", 60 * 24 * mins, 60 * mins + 15)
        await this.addRepeatingJob("batch-jobs", mins / 2, 0)

        const waitingJobs = await this.queue.getJobs(['waiting'])
        const delayedJobs = await this.queue.getJobs(['delayed'])

        console.log("Waiting jobs:", waitingJobs.length)
        waitingJobs.forEach((job) => {
            console.log(job.id, job.name)
        })
        console.log("Delayed jobs:", delayedJobs.length)
        delayedJobs.forEach((job) => {
            console.log(job.id, job.name)
        })

        await this.queue.waitUntilReady()
    }


    async addJob(name: string, data: any, priority: number = 2) {
        await this.queue.add(name, data, {priority})
    }

    async removeAllRepeatingJobs() {
        const jobs = await this.queue.getJobSchedulers()
        for (const job of jobs) {
            console.log(`Removing repeat job: ${job.name}`)
            if(job.key){
                await this.queue.removeJobScheduler(job.key)
            }
        }
    }

    async addRepeatingJob(name: string, every: number, delay: number) {
        await this.queue.add(
            name,
            {},
            {
                repeat: {
                    every: every
                },
                priority: 1,
                jobId: `${name}-repeating`,
                delay: delay,
                removeOnComplete: true,
                removeOnFail: true,
            }
        )
    }


    async batchJobs() {
        console.log("Batching jobs...")
        const t1 = Date.now()

        const allJobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized', 'waiting-children', 'wait', 'repeat']);
        console.log(`Found jobs: ${allJobs.length}.`)
        const batchSize = 500

        try {
            const contributionJobs = allJobs.filter(job =>
                job && job.name == 'update-topic-contributions'
            );

            console.log(`Filtered jobs: ${contributionJobs.length}.`)


            if (contributionJobs.length <= 1) {
                console.log("No jobs require batching.")
                return
            }

            const topicIds = contributionJobs.flatMap(job => job.data as string[])

            console.log(`Removing ${contributionJobs.length} jobs.`)
            await Promise.all(contributionJobs.map(async job => {
                try {
                    await job.remove()
                } catch (err) {
                    console.log(`Error removing job ${job.name}:`, err)
                }
            }));

            for (let i = 0; i < topicIds.length; i += batchSize) {
                const batchIds = topicIds.slice(i, i + batchSize)
                console.log(`Adding update-topic-contributions job with ${batchIds.length} topics.`)
                await this.addJob('update-topic-contributions', batchIds);
            }

            console.log(`Done after ${Date.now()-t1}s`)
        } catch (err) {
            console.log("Error batching jobs:", err)
        }
    }

}