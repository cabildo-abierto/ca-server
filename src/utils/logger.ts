import pino from "pino";
import {env} from "#/lib/env.js";
import pretty from 'pino-pretty'



export class Logger {
    pino: pino.Logger

    constructor(name: string) {
        if(env.NODE_ENV === 'test') {
            this.pino = pino(pretty({sync: true}))
        } else {
            this.pino = pino({name})
        }
    }

    logTimes(msg: string, times: number[], object?: Record<string, unknown>){
        const diffs: number[] = []
        for(let i = 1; i < times.length; i++){
            diffs.push(times[i]-times[i-1])
        }
        const sum = diffs.join(" + ")

        this.pino.info({...object, elapsed: `${times[times.length-1]-times[0]} = ${sum}`}, msg)
    }
}