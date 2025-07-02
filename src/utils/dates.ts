

export const formatIsoDate = (isoDate: string | Date) => {
    const date = new Date(isoDate);
    const argentinaTime = new Intl.DateTimeFormat("es-AR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
    }).format(date);

    return argentinaTime;
}


export const yesterday = () => {
    return new Date(Date.now() - 24 * 60 * 60 * 1000)
}


export function sortDatesDescending(a: Date | string, b: Date | string) {
    return new Date(b).getTime() - new Date(a).getTime()
}