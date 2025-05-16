import {PrismaClient} from "@prisma/client";

export type PrismaTransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">
export type PrismaFunctionTransaction = (db: PrismaTransactionClient) => Promise<void>
export type PrismaUpdateListTransaction = PrismaUpdate[]
export type PrismaUpdate = any


export async function batchPromises(promises: Promise<any>[], batchSize: number, retries: number = 1) {
    if(promises.length > batchSize) console.log("Batching", promises.length, "promises")

    for(let i = 0; i < promises.length; i += batchSize){
        if(promises.length > batchSize) console.log("starting batch in index", i, "of", promises.length)
        const updates = promises.slice(i, i+batchSize)
        let updateOk = false

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await Promise.all(updates)
                updateOk = true
                break
            } catch (error) {
                console.log(error)
                await new Promise(res => setTimeout(res, 100 * attempt));
            }
        }

        if(!updateOk) {
            console.log("Failed to apply some promises.")
            return
        }
    }

    if(promises.length > batchSize) console.log("Finished batch promises")
}


export class SyncUpdate {
    db: PrismaClient
    functionTransactions: PrismaFunctionTransaction[] = []
    updateListTransactions: PrismaUpdateListTransaction[] = []
    updates: PrismaUpdate[] = []

    constructor(db: PrismaClient) {
        this.db = db
    }

    addFunctionTransaction(transaction: PrismaFunctionTransaction) {
        this.functionTransactions.push(transaction)
    }

    addUpdate(update: PrismaUpdate) {
        this.updates.push(update)
    }

    addUpdates(updates: PrismaUpdate[]) {
        this.updates.push(...updates)
    }

    addUpdatesAsTransaction(updates: PrismaUpdate[]) {
        this.updateListTransactions.push(updates)
    }

    joinWith(other: SyncUpdate) {
        this.functionTransactions.push(...other.functionTransactions)
        this.updateListTransactions.push(...other.updateListTransactions)
        this.updates.push(...other.updates)
    }

    async apply() {
        const promises = this.getPromises()
        await batchPromises(promises, 1)
    }

    getPromises(): Promise<any>[] {
        return [
            ...this.updates,
            ...this.functionTransactions.map(t => this.db.$transaction(t)),
            ...this.updateListTransactions.map(t => this.db.$transaction(t))
        ]
    }
}