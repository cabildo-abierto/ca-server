import {updateCategoriesGraph} from "#/services/wiki/graph";
import {Worker} from 'bullmq';
import {AppContext} from "#/setup";
import {syncAllUsers, syncUserJobHandler, updateRecordsCreatedAt} from "#/services/sync/sync-user";
import {updateAuthorStatus} from "#/services/user/users";
import {
    cleanNotCAReferences,
    restartReferenceLastUpdate, updateContentsTopicMentions,
    updateReferences,
    updateTopicMentions
} from "#/services/wiki/references";
import {updateEngagementCounts} from "#/services/feed/getUserEngagement";
import {deleteCollection} from "#/services/delete";
import {updateTopicPopularityScores} from "#/services/wiki/popularity";
import {updateTopicsCategories} from "#/services/wiki/categories";
import {
    updateAllTopicContributions,
    updateTopicContributions,
    updateTopicContributionsRequired
} from "#/services/wiki/contributions";
import {createUserMonths} from "#/services/monetization/user-months";
import {Queue} from "bullmq";
import Redis from "ioredis";
import {createNotificationJob, createNotificationsBatchJob} from "#/services/notifications/notifications";
import {CAHandler} from "#/utils/handler";
import {assignInviteCodesToUsers} from "#/services/user/access";
import {resetContentsFormat, updateContentsNumWords, updateContentsText} from "#/services/wiki/content";
import {updateThreads} from "#/services/wiki/threads";
import {restartLastContentInteractionsUpdate} from "#/services/wiki/interactions";
import {updatePostLangs} from "#/services/admin/posts";
import {createPaymentPromises} from "#/services/monetization/promise-creation";
import {updateFollowSuggestions} from "#/services/user/follow-suggestions";
import {updateInteractionsScore} from "#/services/feed/feed-scores";
import {updateAllTopicsCurrentVersions} from "#/services/wiki/current-version";
import { Logger } from "#/utils/logger";

const mins = 60 * 1000

type CAJobHandler<T> = (data: T) => Promise<void>

type CAJobDefinition<T> = {
    name: string
    handler: CAJobHandler<T>
}


export class CAWorker {
    worker?: Worker
    ioredis: Redis
    queue: Queue
    jobs: CAJobDefinition<any>[] = []
    logger: Logger

    constructor(ioredis: Redis, worker: boolean, logger: Logger) {
        this.logger = logger
        const env = process.env.NODE_ENV || "development"
        const queueName = `${env}-queue`
        const queuePrefix = undefined
        this.ioredis = ioredis
        this.logger.pino.info({queueName, queuePrefix}, `starting queue`)
        this.queue = new Queue(queueName, {
            prefix: queuePrefix,
            connection: ioredis
        })

        if(worker){
            this.logger.pino.info({queueName, queuePrefix})
            this.worker = new Worker(queueName, async (job) => {
                    for (let i = 0; i < this.jobs.length; i++) {
                        if (job.name.startsWith(this.jobs[i].name)) {
                            await this.jobs[i].handler(job.data)
                            return
                        }
                    }
                    this.logger.pino.warn({name: job.name}, "no handler for job")
                },
                {
                    connection: ioredis,
                    lockDuration: 60 * 1000 * 5
                }
            )
            this.worker.on('failed', (job, err) => {
                this.logger.pino.error({name: job?.name, error: err}, `job failed`);
            })
            this.worker.on('error', (err) => {
                this.logger.pino.error({error: err} ,'worker error');
            })
            this.worker.on('active', (job) => {
                this.logger.pino.info({name: job.name}, `job started`)
            })
            this.worker.on('completed', (job) => {
                this.logger.pino.info({name: job.name}, `job completed`)
            })
        }
    }

    registerJob(jobName: string, handler: (data: any) => Promise<void>) {
        this.jobs.push({name: jobName, handler})
    }

    async setup(ctx: AppContext) {
        this.registerJob( "update-categories-graph", () => updateCategoriesGraph(ctx))
        this.registerJob( "sync-user", async (data: any) => await syncUserJobHandler(ctx, data))
        this.registerJob("update-references", () => updateReferences(ctx))
        this.registerJob( "update-engagement-counts", () => updateEngagementCounts(ctx))
        this.registerJob( "delete-collection", async (data) => {
            await deleteCollection(ctx, (data as { collection: string }).collection)
        })
        this.registerJob("update-topics-popularity", () => updateTopicPopularityScores(ctx))
        this.registerJob("sync-all-users", (data) => syncAllUsers(ctx, (data as { mustUpdateCollections: string[] }).mustUpdateCollections))
        this.registerJob("delete-collection", (data) => deleteCollection(ctx, (data as { collection: string }).collection))
        this.registerJob("update-topics-categories", () => updateTopicsCategories(ctx))
        this.registerJob("update-topic-contributions", (data) => updateTopicContributions(ctx, data.topicIds as string[]))
        this.registerJob("update-all-topic-contributions", (data) => updateAllTopicContributions(ctx))
        this.registerJob("required-update-topic-contributions", (data) => updateTopicContributionsRequired(ctx))
        this.registerJob("create-user-months", () => createUserMonths(ctx))
        this.registerJob("create-notification", (data) => createNotificationJob(ctx, data))
        this.registerJob("batch-create-notifications", (data) => createNotificationsBatchJob(ctx, data))
        this.registerJob("batch-jobs", () => this.batchJobs())
        this.registerJob("test-job", async () => {this.logger.pino.info("test job run")})
        this.registerJob("restart-references-last-update", () => restartReferenceLastUpdate(ctx))
        this.registerJob("restart-interactions-last-update", () => restartLastContentInteractionsUpdate(ctx))
        this.registerJob("clean-not-ca-references", () => cleanNotCAReferences(ctx))
        this.registerJob("assign-invite-codes", () => assignInviteCodesToUsers(ctx))
        this.registerJob("update-topic-mentions", (data) => updateTopicMentions(ctx, data.id as string))
        this.registerJob("update-contents-topic-mentions", (data) => updateContentsTopicMentions(ctx, data.uris as string[]))
        this.registerJob("update-contents-text", () => updateContentsText(ctx))
        this.registerJob("update-num-words", () => updateContentsNumWords(ctx))
        this.registerJob("reset-contents-format", () => resetContentsFormat(ctx))
        this.registerJob("update-threads", () => updateThreads(ctx))
        this.registerJob("update-post-langs", () => updatePostLangs(ctx))
        this.registerJob("update-author-status-all", () => updateAuthorStatus(ctx))
        this.registerJob("update-author-status", (data) => updateAuthorStatus(ctx, data.dids))
        this.registerJob("create-payment-promises", () => createPaymentPromises(ctx))
        this.registerJob("update-topics-current-versions", () => updateAllTopicsCurrentVersions(ctx))
        this.registerJob("update-follow-suggestions", () => updateFollowSuggestions(ctx))
        this.registerJob("update-records-created-at", () => updateRecordsCreatedAt(ctx))
        this.registerJob("update-interactions-score", (data) => updateInteractionsScore(ctx, data.uris))
        this.registerJob("update-all-interactions-score", () => updateInteractionsScore(ctx))

        await this.removeAllRepeatingJobs()
        await this.addRepeatingJob("update-topics-popularity", 30 * mins, 60 * mins)
        await this.addRepeatingJob("update-topics-categories", 30 * mins, 60 * mins + 5)
        await this.addRepeatingJob("update-categories-graph", 30 * mins, 60 * mins + 7)
        await this.addRepeatingJob("create-user-months", 30 * mins, 60 * mins + 15)
        await this.addRepeatingJob("batch-jobs", mins / 2, 0)
        await this.addRepeatingJob("update-follow-suggestions", 30 * mins, 30 * mins + 18)

        const waitingJobs = await this.queue.getJobs(['waiting'])
        const delayedJobs = await this.queue.getJobs(['delayed'])

        this.logger.pino.info({
            waitingJobsCount: waitingJobs.length,
            delayedJobsCount: delayedJobs.length,
            waitingJobs: waitingJobs.map(j => (j ? {id: j.id, name: j.name} : null)),
            delayedJobs: delayedJobs.map(j => (j ? {id: j.id, name: j.name} : null)),
        }, "current jobs")

        await this.queue.waitUntilReady()
    }


    async addJob(name: string, data: any, priority: number = 2) {
        this.logger.pino.info({name}, "job added")
        await this.queue.add(name, data, {priority})
    }

    async removeAllRepeatingJobs() {
        const jobs = await this.queue.getJobSchedulers()
        for (const job of jobs) {
            this.logger.pino.info({name: job.name}, "repeat job removed")
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
        this.logger.pino.info({name}, "repeat job added")
    }


    async batchJobs() {
        const t1 = Date.now()

        const allJobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized', 'waiting-children', 'wait', 'repeat']);
        this.logger.pino.info({count: allJobs.length}, `batching jobs`)
        const batchSize = 500

        try {
            await this.batchContributionsJobs(allJobs, batchSize)
            await this.batchInteractionsScoreJobs(allJobs, batchSize)

            this.logger.logTimes("jobs batched", [t1, Date.now()])
        } catch (err) {
            this.logger.pino.error(err, "error batching jobs")
        }
    }


    async batchInteractionsScoreJobs(allJobs: any[], batchSize: number) {
        const scoresJobs = allJobs.filter(job =>
            job && job.name == 'update-interactions-score'
        );

        const jobsRequireBatching = scoresJobs.filter(job => job.data.length < batchSize)

        if (jobsRequireBatching.length <= 1) {
            return
        }

        const uris = jobsRequireBatching.flatMap(job => job.data as string[])

        this.logger.pino.info({count: jobsRequireBatching.length, name: "update-interactions-score"}, `removing jobs`)
        await Promise.all(jobsRequireBatching.map(async job => {
            try {
                await job.remove()
            } catch (err) {
                this.logger.pino.error({name: job.name, error: err}, `error removing job`)
            }
        }))

        for (let i = 0; i < uris.length; i += batchSize) {
            const batchIds = uris.slice(i, i + batchSize)
            await this.addJob('update-interactions-score', {uris: batchIds})
        }
    }


    async batchContributionsJobs(allJobs: any[], batchSize: number) {
        const contributionJobs = allJobs.filter(job =>
            job && job.name == 'update-topic-contributions'
        )

        const jobsRequireBatching = contributionJobs
            .filter(job => job.data.length < batchSize)

        if (jobsRequireBatching.length <= 1) {
            return
        }

        const topicIds = jobsRequireBatching.flatMap(job => job.data as string[])

        this.logger.pino.info({count: jobsRequireBatching.length, name: "update-topic-contributions"}, `removing jobs`)
        await Promise.all(jobsRequireBatching.map(async job => {
            try {
                await job.remove()
            } catch (err) {
                this.logger.pino.error({error: err, name: job.name}, "error removing job")
            }
        }));

        for (let i = 0; i < topicIds.length; i += batchSize) {
            const batchIds = topicIds.slice(i, i + batchSize)
            await this.addJob('update-topic-contributions', {topicIds: batchIds})
        }
    }
}


export const startJob: CAHandler<any, {}> = async (ctx, app, data) => {
    const {id} = data.params

    await ctx.worker?.addJob(id, data)

    return {data: {}}
}