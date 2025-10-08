import pino from "pino";
import {env} from "#/lib/env.js";


const transport =
    env.NODE_ENV === 'test'
        ?
        pino.transport({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
            },
        })
        :
        undefined;


export class Logger {
    pino: pino.Logger

    constructor(name: string) {
        this.pino = pino({name}, transport)
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