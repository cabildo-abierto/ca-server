import {CAHandler} from "#/utils/handler";
import {ValidationRequestResult, ValidationType} from "@prisma/client";
import {SupabaseClient} from "@supabase/supabase-js";
import {uuid} from "@supabase/supabase-js/dist/main/lib/helpers";
import {Dataplane} from "#/services/hydration/dataplane";
import {hydrateProfileViewBasic} from "#/services/hydration/profile";
import {ProfileViewBasic} from "#/lex-api/types/ar/cabildoabierto/actor/defs"
import {createHash} from "crypto";
import {v4 as uuidv4} from "uuid";

export type FilePayload = { base64: string, fileName: string }

type OrgType = "creador-individual" | "empresa" | "medio" | "fundacion" | "consultora" | "otro"

type ValidationRequestProps = {
    tipo: "persona"
    dniFrente: FilePayload
    dniDorso: FilePayload
} | {
    tipo: "org"
    tipoOrg: OrgType
    sitioWeb: string
    email: string
    documentacion: FilePayload[]
    comentarios: string
}


function extractMimeType(base64: string): string | null {
    const match = base64.match(/^data:(.*?);base64,/);
    return match ? match[1] : null;
}

export function sanitizeFileName(fileName: string): string {
    return fileName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9.\-_ ]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase();
}

export async function uploadToSBStorage(sb: SupabaseClient, file: FilePayload, bucket: string) {
    const id = uuid();
    const fileBuffer = Buffer.from(file.base64.split(',')[1], 'base64');

    const safeFileName = sanitizeFileName(file.fileName);
    const filePath = `${id}/${safeFileName}`;

    const { data, error } = await sb.storage
        .from(bucket)
        .upload(filePath, fileBuffer, {
            contentType: extractMimeType(file.base64) || 'application/octet-stream'
        });

    if (error) {
        console.log(`Error uploading file ${filePath} to storage`);
        console.log(error);
    }

    return { path: data?.path, error };
}


export const createValidationRequest: CAHandler<ValidationRequestProps, {}> = async (ctx, agent, request) => {
    try {
        const documentacion = request.tipo == "org" && request.documentacion ? await Promise.all(request.documentacion.map((f => uploadToSBStorage(ctx.sb, f, 'validation-documents')))) : []
        const dniFrente = request.tipo == "persona" && request.dniFrente ? await uploadToSBStorage(ctx.sb, request.dniFrente, 'validation-documents') : undefined
        const dniDorso = request.tipo == "persona" && request.dniDorso ? await uploadToSBStorage(ctx.sb, request.dniDorso, 'validation-documents') : undefined

        if (dniFrente && dniFrente.error) return {error: "Ocurrió un error al procesar la solicitud."}
        if (dniDorso && dniDorso.error) return {error: "Ocurrió un error al procesar la solicitud."}
        if (documentacion && documentacion.some(x => !x || x && x.error)) return {error: "Ocurrió un error al procesar la solicitud."}

        if (request.tipo == "persona" && !dniFrente) return {error: "Debe incluir una foto del frente de su DNI."}
        if (request.tipo == "persona" && !dniDorso) return {error: "Debe incluir una foto del dorso de su DNI."}

        const data = request.tipo == "org" ? {
            type: ValidationType.Organizacion,
            documentacion: documentacion ? documentacion.map(d => d?.path) as string[] : [],
            userId: agent.did,
            comentarios: request.comentarios,
            sitioWeb: request.sitioWeb,
            email: request.email,
            tipoOrg: request.tipoOrg
        } : {
            type: ValidationType.Persona,
            dniFrente: dniFrente?.path,
            dniDorso: dniDorso?.path,
            userId: agent.did,
            documentacion: []
        }

        await ctx.kysely.insertInto("ValidationRequest")
            .values([{
                ...data,
                id: uuidv4()
            }])
            .execute()
    } catch (error) {
        console.log("error creating validation request", error)
        return {error: "Ocurrió un error al crear la solicitud. Volvé a intentar."}
    }

    return {data: {}}
}


export const getValidationRequest: CAHandler<{}, { type: "org" | "persona" | null, result?: ValidationRequestResult }> = async (ctx, agent, {}) => {
    const res = await ctx.kysely
        .selectFrom("ValidationRequest")
        .select(["type", "result"])
        .where("userId", "=", agent.did)
        .executeTakeFirst()

    if(!res) return {data: {type: null}}

    return {
        data: {
            type: res.type == "Persona" ? "persona" : "org",
            result: res.result
        }
    }
}


export const cancelValidationRequest: CAHandler<{}, {}> = async (ctx, agent, {}) => {
    await ctx.kysely.deleteFrom("ValidationRequest")
        .where("userId", "=", agent.did)
        .execute()

    return {data: {}}
}


export type ValidationRequestView = {
    id: string
    user: ProfileViewBasic
    createdAt: Date
} & ({
    tipo: "persona"
    dniFrente: FilePayload
    dniDorso: FilePayload
} | {
    tipo: "org"
    tipoOrg: OrgType
    sitioWeb?: string
    email?: string
    documentacion: FilePayload[]
    comentarios?: string
})


function getFileNameFromPath(path: string) {
    const s = path.split("::")
    return s[s.length - 1]
}


export const getPendingValidationRequests: CAHandler<{}, {
    requests: ValidationRequestView[],
    count: number
}> = async (ctx, agent, {}) => {
    const [requests, count] = await Promise.all([
        ctx.kysely
            .selectFrom("ValidationRequest")
            .select([
                "id",
                "dniFrente",
                "dniDorso",
                "created_at as createdAt",
                "documentacion",
                "userId",
                "type",
                "tipoOrg",
                "sitioWeb",
                "comentarios",
                "sitioWeb",
                "email"
            ])
            .where("result", "=", ValidationRequestResult.Pendiente)
            .limit(10)
            .execute(),
        ctx.kysely.selectFrom("ValidationRequest")
            .select(eb => eb.fn.count<number>("id").as("count"))
            .where("result", "=", ValidationRequestResult.Pendiente)
            .executeTakeFirst()
    ])

    const dataplane = new Dataplane(ctx, agent)

    const files = [
        ...requests.map(r => r.dniFrente),
        ...requests.map(r => r.dniDorso),
        ...requests.flatMap(r => r.documentacion),
    ].filter(x => x != null)

    await Promise.all([
        dataplane.fetchUsersHydrationData(requests.map(r => r.userId)),
        dataplane.fetchFilesFromStorage(files, "validation-documents")
    ])

    const res: ValidationRequestView[] = requests.map(r => {
        const user = hydrateProfileViewBasic(r.userId, dataplane)
        if (!user) return null
        const tipo: "org" | "persona" = r.type == "Persona" ? "persona" : "org"
        if (tipo == "org") {
            const req: ValidationRequestView = {
                tipo: "org",
                ...r,
                tipoOrg: r.tipoOrg as OrgType,
                user,
                sitioWeb: r.sitioWeb ?? undefined,
                email: r.email ?? undefined,
                comentarios: r.comentarios ?? undefined,
                documentacion: r.documentacion ? r.documentacion.map(d => {
                    return {
                        fileName: getFileNameFromPath(d),
                        base64: dataplane.sbFiles.get("validation-documents:" + d) ?? "not found"
                    }
                }) : []
            }
            return req
        } else {
            if (!r.dniFrente || !r.dniDorso) return null
            const req: ValidationRequestView = {
                tipo: "persona",
                ...r,
                user,
                dniFrente: {
                    fileName: getFileNameFromPath(r.dniFrente),
                    base64: dataplane.sbFiles.get("validation-documents:" + r.dniFrente) ?? "not found"
                },
                dniDorso: {
                    fileName: getFileNameFromPath(r.dniDorso),
                    base64: dataplane.sbFiles.get("validation-documents:" + r.dniDorso) ?? "not found"
                }
            }
            return req
        }
    }).filter(x => x != null)

    return {data: {requests: res, count: count?.count ?? 0}}
}


type ValidationRequestResultProps = {
    id: string
    result: "accept" | "reject"
    reason: string
    dni?: number
}


async function getHashFromDNI(dni: number) {
    const hash = createHash('sha256');
    hash.update(dni.toString());
    return hash.digest('hex');
}


export const setValidationRequestResult: CAHandler<ValidationRequestResultProps, {}> = async (ctx, agent, result) => {
    return ctx.kysely.transaction().execute(async trx => {
        const req = await trx
            .selectFrom("ValidationRequest")
            .innerJoin("User", "User.did", "ValidationRequest.userId")
            .select([
                "type",
                "did",
                "handle",
                "displayName",
                "avatar",
                "banner"
            ])
            .where("id", "=", result.id)
            .executeTakeFirst()

        if (!req) return {error: "No se encontró la solicitud."}

        const {type, ...user} = req

        await trx.updateTable("ValidationRequest")
            .set("result", result.result == "accept" ? "Aceptada" : "Rechazada")
            .where("id", "=", result.id)
            .execute()

        if (type == "Persona") {
            if (!result.dni) {
                return {error: "Falta el número de DNI."}
            }
            const userValidationHash = await getHashFromDNI(result.dni)
            await trx.updateTable("User")
                .set("userValidationHash", userValidationHash)
                .where("did", "=", user.did)
                .execute()
            await ctx.redisCache.onEvent("verification-update", [user.did])
        } else {
            await trx.updateTable("User")
                .set("orgValidation", JSON.stringify(user))
                .where("did", "=", user.did)
                .execute()
            await ctx.redisCache.onEvent("verification-update", [user.did])
        }
        return {data: {}}
    })
}