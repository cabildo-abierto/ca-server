import 'dotenv/config'
import { Server } from './server'
import cluster from 'cluster'
import os from 'os';
import {env} from "#/lib/env";


export type Role = "worker" | "web" | "mirror"

export const run = async (roles: Role[]) => {
    const server = await Server.create(roles)

    const onCloseSignal = async () => {
        setTimeout(() => process.exit(1), 10000).unref() // Force shutdown after 10s
        await server.close()
        process.exit()
    }

    process.on('SIGINT', onCloseSignal)
    process.on('SIGTERM', onCloseSignal)
}

const maxCpus = env.MAX_APP_CPUS

if (cluster.isPrimary) {
    const numCPUs = Math.min(os.cpus().length, maxCpus)
    console.log(`Master ${process.pid} running APP with ${numCPUs} workers`)
    for (let i = 0; i < numCPUs; i++) cluster.fork()

    cluster.on('exit', (worker) => {
        console.error(`APP Worker ${worker.process.pid} died`)
        cluster.fork()
    })
} else {
    run(["web"])
}
