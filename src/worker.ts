import {run} from "#/index-worker";
import cluster from "cluster";
import os from "os";
import {env} from "#/lib/env";

const maxCpus = env.MAX_WORKER_CPUS

if (cluster.isPrimary) {
    const numCPUs = Math.min(os.cpus().length, maxCpus)
    console.log(`Master ${process.pid} running WORKER with ${numCPUs} workers`)
    for (let i = 0; i < numCPUs; i++) cluster.fork()

    cluster.on('exit', (worker) => {
        console.log(`WORKER Worker ${worker.process.pid} died`)
        cluster.fork()
    })
} else {
    run(["worker"])
}