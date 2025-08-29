import WebSocket, {RawData} from 'ws';
import {getCAUsersDids} from "#/services/user/users";
import {AppContext} from "#/index";
import {processCommitEvent} from "#/services/sync/process-event";
import {isCAProfile, isFollow} from "#/utils/uri";
import {addPendingEvent, getCAUsersAndFollows} from "#/services/sync/sync-user";
import {CommitEvent, JetstreamEvent} from "#/lib/types";

import * as Follow from "#/lex-api/types/app/bsky/graph/follow"
import {logTimes} from "#/utils/utils";
import {getUserMirrorStatus, mirrorStatusKeyPrefix, setMirrorStatus} from "#/services/sync/mirror-status";
import {redisDeleteByPrefix} from "#/services/user/follow-suggestions";

export class MirrorMachine {
    caUsers: Set<string> = new Set()
    extendedUsers: Set<string> = new Set()
    eventCounter: number = 0
    lastLog: Date = new Date()
    lastRetry: Map<string, Date> = new Map()

    ctx: AppContext

    constructor(ctx: AppContext){
        this.ctx = ctx
    }

    async fetchUsers(){
        console.log("Setting up mirror...")
        const dids = await getCAUsersDids(this.ctx)
        const extendedUsers = (await getCAUsersAndFollows(this.ctx)).map(x => x.did)
        await redisDeleteByPrefix(this.ctx, mirrorStatusKeyPrefix(this.ctx))
        this.caUsers = new Set(dids)
        this.extendedUsers = new Set(extendedUsers.filter(x => !this.caUsers.has(x)))
        console.log("Mirror ready.")
    }

    logEventsPerSecond(){
        const elapsed = Date.now() - this.lastLog.getTime()
        if(elapsed > 60*1000){
            console.log("Events per second: ", this.eventCounter / (elapsed / 1000))
            this.eventCounter = 0
            this.lastLog = new Date()
        }
    }

    async run(){
        await this.fetchUsers()
        console.log("CA users:", this.caUsers.size)
        console.log("Extended users:", this.extendedUsers.size)
        const url = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.*&wantedCollections=ar.cabildoabierto.*'
        const ws = new WebSocket(url)

        ws.on('open', () => {
            console.log('Connected to the WebSocket server');
        })

        ws.on('message', async (data: RawData) => {
            this.logEventsPerSecond()

            const e: JetstreamEvent = JSON.parse(data.toString())

            if(e.kind == "commit") {
                const c = e as CommitEvent
                if(isCAProfile(c.commit.collection) && c.commit.rkey == "self"){
                    this.caUsers.add(e.did)
                    this.extendedUsers.add(e.did)
                    console.log("Added user", e.did)
                }
            }

            const inCA = this.caUsers.has(e.did)
            const inExtended = this.extendedUsers.has(e.did)

            if(!inCA && !inExtended){
                return
            }

            if(inCA){
                this.eventCounter++
                await this.processEvent(this.ctx, e, inCA)
                if(e.kind == "commit" && isFollow((e as CommitEvent).commit.collection)){
                    const record: Follow.Record = (e as CommitEvent).commit.record
                    if((e as CommitEvent).commit.operation == "create"){
                        this.extendedUsers.add(record.subject)
                        console.log("Added extended user", record.subject)
                    }
                }
            } else if(inExtended && e.kind == "commit" && isFollow((e as CommitEvent).commit.collection)){
                this.eventCounter++
                await this.processEvent(this.ctx, e, inCA)
            }
        })

        ws.on('error', (error: Error) => {
            console.error('WebSocket error:', error);
        })

        ws.on('close', () => {
            console.log('WebSocket connection closed');
        })
    }

    async processEvent(ctx: AppContext, e: JetstreamEvent, inCA: boolean) {
        const mirrorStatus = await getUserMirrorStatus(ctx, e.did, inCA)
        console.log("event!", e.did, mirrorStatus)

        if(mirrorStatus == "Sync"){
            if(e.kind == "commit"){
                const t1 = Date.now()
                await processCommitEvent(ctx, e)
                const t2 = Date.now()
                const c = (e as CommitEvent)
                logTimes(`process commit ${c.commit.operation} event: ${c.commit.uri}`, [t1, t2])
            }

        } else if(mirrorStatus == "Dirty"){
            await setMirrorStatus(ctx, e.did, "InProcess", inCA)
            await ctx.worker?.addJob("sync-user", {
                handleOrDid: e.did,
                collectionsMustUpdate: inCA ? undefined : ["app.bsky.graph.follow"]
            })

        } else if(mirrorStatus == "InProcess"){
            await addPendingEvent(ctx, e.did, e)

        } else if(mirrorStatus == "Failed") {
            const last = this.lastRetry.get(e.did)
            if(!last || last.getTime() - Date.now() > 6*3600*1000){
                this.lastRetry.set(e.did, new Date())
                await setMirrorStatus(ctx, e.did, "InProcess", inCA)
                await ctx.worker?.addJob("sync-user", {handleOrDid: e.did})
            }
        }
    }
}