import pino from 'pino'
import {IdResolver} from '@atproto/identity'
import {Firehose} from '@atproto/sync'
import * as Status from '#/lexicon/types/xyz/statusphere/status'
import {PrismaClient} from '@prisma/client'

export function createIngester(db: PrismaClient, idResolver: IdResolver) {
    const logger = pino({name: 'firehose ingestion'})
    return new Firehose({
        idResolver,
        handleEvent: async (evt) => {
            // Watch for write events
            if (evt.event === 'create' || evt.event === 'update') {
                const now = new Date()
                const record = evt.record

                // If the write is a valid status update
                if (
                    evt.collection === 'xyz.statusphere.status' &&
                    Status.isRecord(record) &&
                    Status.validateRecord(record).success
                ) {
                    // Store the status
                }
            } else if (
                evt.event === 'delete' &&
                evt.collection === 'xyz.statusphere.status'
            ) {
                // Remove the status
            }
        },
        onError: (err) => {
            logger.error({err}, 'error on firehose ingestion')
        },
        filterCollections: ['xyz.statusphere.status'],
        excludeIdentity: true,
        excludeAccount: true,
    })
}
