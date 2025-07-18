import stringify from "json-stable-stringify";
import objectHash from "object-hash";

export function getObjectKey(obj: any): string {
    const stableStr = stringify(obj);
    return stableStr ? objectHash(stableStr) : "null"
}

export function union<T>(s: Set<T>, t: Set<T>): Set<T> {
    const m = new Set<T>(s)
    t.forEach(x => {m.add(x)})
    return m
}


export function max<T>(a: T[], f?: (x: T) => number): T | undefined {
    if (a.length === 0) return undefined
    return a.reduce((max, current) => ((f ? f(current) > f(max) : current > max) ? current : max));
}


export function min<T>(a: T[], f?: (x: T) => number): T | undefined {
    return max(a, x => f ? -f(x) : -x)
}


export function sum<T>(a: T[], f: (x: T) => number): number {
    return a.reduce((acc, x) => acc+f(x), 0)
}

export function count<T>(a: T[], f: (x: T) => boolean): number {
    return sum(a, x => f(x) ? 1 : 0)
}



export const removeNullValues = <K, V>(m: Map<K, V | null>): Map<K, V> => {
    const res = new Map<K, V>()
    m.forEach((v, k) => {
        if(v !== null && v !== undefined){
            res.set(k, v)
        }
    })
    return res
};


export function unique<T, K>(list: T[], key?: (x: T) => K, removeNulls: boolean = false): T[]{
    if(key){
        const seen = new Set<K>()
        const unique: T[] = []
        list.forEach(x => {
            if(removeNulls && (x === null || x === undefined)) return
            const k = key(x)
            if(!seen.has(k)){
                unique.push(x)
                seen.add(k)
            }
        })
        return unique
    }

    return Array.from(new Set(list))
}

export function areArraysEqual(a: any[] | null | undefined, b: any[] | null | undefined) {
    if ((a == null) != (b == null)) return false
    if (a == null || b == null) return true
    if (a.length != b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) return false
    }
    return true
}

export function makeMatrix(n: number, m: number, v: number){
    let M = new Array<Array<number>>(n)
    for(let i = 0; i < n; i++) M[i] = new Array<number>(m).fill(v)
    return M
}

export function newestFirst(a: { createdAt?: Date, reason?: { createdAt: Date } }, b: {
    createdAt?: Date,
    reason?: { createdAt: Date }
}) {
    if (!a.createdAt || !b.createdAt) return 0
    const dateA = a.reason ? a.reason.createdAt : a.createdAt
    const dateB = b.reason ? b.reason.createdAt : b.createdAt
    return new Date(dateB).getTime() - new Date(dateA).getTime()
}

export function oldestFirst(a: { createdAt?: Date }, b: { createdAt?: Date }) {
    return -newestFirst(a, b)
}

export function listOrder(a: number[], b: number[]) {
    if (!a || !b) return 0
    for (let i = 0; i < a.length; i++) {
        if (a[i] > b[i]) {
            return 1
        } else if (a[i] < b[i]) {
            return -1
        }
    }
    return 0
}

export function listOrderDesc(a: number[], b: number[]) {

    return -listOrder(a, b)
}


export function range(a: number, b?: number){
    if(b != undefined){
        return Array.from({ length: b-a }, (_, i) => a+i)
    }
    return Array.from({ length: a }, (_, i) => i)
}


export function sortByKey<T, V>(a: T[], keyFn: (x: T) => V, keyCmp: (a: V, b: V) => number){
    function cmp(a: {x: T, key: V}, b: {x: T, key: V}) {
        return keyCmp(a.key, b.key)
    }

    return a.map(x => ({x, key: keyFn(x)})).sort(cmp).map(({x}) => x)
}


export function concat<T>(a: T[][]): T[] {
    return a.reduce((acc: T[], cur: T[]) => ([...acc, ...cur]), [])
}


export function gett<K, V>(map: Map<K, V>, key: K): V {
    const value = map.get(key);
    if (value === undefined) {
        throw new Error(`Key not found in map: ${String(key)}`)
    }
    return value;
}