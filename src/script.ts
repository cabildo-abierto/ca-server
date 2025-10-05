import {setupAppContext} from "#/setup"
import {updateInteractionsScore} from "#/services/feed/feed-scores";


async function run() {
    const {ctx} = await setupAppContext([])

    await updateInteractionsScore(ctx)
}

run()