

export const formatIsoDate = (isoDate: string | Date) => {
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat("es-AR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
    }).format(date);
}


export function sortDatesDescending(a: Date | string, b: Date | string) {
    return new Date(b).getTime() - new Date(a).getTime()
}