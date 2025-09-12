import {BlobRef} from "@atproto/lexicon";
import {CID} from 'multiformats/cid'

export function parseRecord(obj: any): any {

    if (Array.isArray(obj)) {
        return obj.map(parseRecord);
    }

    if (obj && typeof obj === 'object') {
        if (obj.$type === 'blob') {
            if (obj.ref?.$link) {
                const cid = CID.parse(obj.ref.$link);
                return new BlobRef(cid, obj.mimeType, obj.size)
            } else {
                throw Error("Invalid blob object")
            }
        }

        const newObj: any = {};
        for (const key in obj) {
            newObj[key] = parseRecord(obj[key]);
        }

        return newObj
    }

    return obj
}

