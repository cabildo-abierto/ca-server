import WebSocket, {RawData} from 'ws';
import {restartSync} from "#/services/sync/sync-user";
import {getCAUsersDids} from "#/services/user/users";
import {AppContext} from "#/index";
import {processEvent} from "#/services/sync/process-event";


export class MirrorMachine {
    knownUsers: Set<string> = new Set()
    ctx: AppContext

    constructor(ctx: AppContext){
        this.ctx = ctx
    }

    async fetchUsers(){
        await restartSync(this.ctx)
        const dids = await getCAUsersDids(this.ctx)
        this.knownUsers = new Set(dids)
    }

    async run(){
        await this.fetchUsers()
        console.log("Known users:", this.knownUsers)
        const url = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.*&wantedCollections=ar.cabildoabierto.*'
        const ws = new WebSocket(url)

        ws.on('open', () => {
            console.log('Connected to the WebSocket server');
        })

        ws.on('message', async (data: RawData) => {
            const e = JSON.parse(data.toString())

            if(e.kind == "commit") {
                if(e.commit.collection == "ar.com.cabildoabierto.profile" && e.commit.rkey == "self"){
                    this.knownUsers.add(e.did)
                    console.log("Added user", e.did)
                }
            }

            if(!this.knownUsers.has(e.did)){
                return
            }

            await processEvent(this.ctx, e)
        })

        ws.on('error', (error: Error) => {
            console.error('WebSocket error:', error);
        })

        ws.on('close', () => {
            console.log('WebSocket connection closed');
        })
    }
}