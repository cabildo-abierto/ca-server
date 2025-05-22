import {PrismaClient} from "@prisma/client";

export type PrismaTransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">
export type PrismaFunctionTransaction = (db: PrismaTransactionClient) => Promise<void>
export type PrismaUpdateListTransaction = PrismaUpdate[]
export type PrismaUpdate = any


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
        const maxUpdateSize = 100

        let curUpdate: PrismaUpdate[] = []
        for (let i = 0; i < this.updates.length; i++) {
            if (curUpdate.length <= maxUpdateSize) {
                curUpdate.push(this.updates[i])
            } else {
                await this.db.$transaction(curUpdate)
                curUpdate = []
            }
        }
        for (let i = 0; i < this.updateListTransactions.length; i++) {
            if (curUpdate.length <= maxUpdateSize) {
                curUpdate.push(...this.updateListTransactions[i])
            } else {
                await this.db.$transaction(curUpdate)
                curUpdate = []
            }
        }
        if(curUpdate.length > 0) await this.db.$transaction(curUpdate)
        for (let i = 0; i < this.functionTransactions.length; i++) {
            await this.db.$transaction(this.functionTransactions[i])
        }
    }
}