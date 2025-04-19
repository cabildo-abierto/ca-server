import pino from 'pino'
import {IdResolver} from '@atproto/identity'
import {Firehose} from '@atproto/sync'
import * as Article from '#/lexicon-server/types/ar/cabildoabierto/feed/article'
import {PrismaClient} from '@prisma/client'

export function createIngester(db: PrismaClient, idResolver: IdResolver) {
    const logger = pino({name: 'firehose ingestion'})
    return new Firehose({
        idResolver,
        handleEvent: async (evt) => {
            // Watch for write events
            if (evt.event === 'create' || evt.event === 'update') {
                const record = evt.record

                try {
                    if (
                        evt.collection === 'ar.cabildoabierto.feed.article' &&
                        Article.isRecord(record) &&
                        Article.validateRecord(record).success
                    ) {
                        console.log(record.text)
                    }
                } catch (err){
                    console.log(err)
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
        filterCollections: ['ar.com.cabildoabierto.article'],
        excludeIdentity: true,
        excludeAccount: true,
    })
}
