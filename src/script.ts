import {setupAppContext} from "#/setup.js"
import {sendSingleEmail} from "#/services/emails/sending.js";


async function run() {
    const {ctx} = await setupAppContext([])

    await sendSingleEmail(
        ctx,
        "tmsdlgd@gmail.com",
        "novedades",
        "Novedades en Cabildo Abierto | Octubre 2025",
        true,
        false
    )
}

run()