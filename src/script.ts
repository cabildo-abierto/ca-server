import {setupAppContext} from "#/setup.js"
import {updateInteractionsScore} from "#/services/feed/feed-scores.js";


async function run() {
    const {ctx} = await setupAppContext([])

    await updateInteractionsScore(ctx)
}

run()