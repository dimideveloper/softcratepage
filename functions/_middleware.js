export async function onRequest(context) {
    const url = new URL(context.request.url);

    if (url.hostname === "www.softcrate.de") {
        url.hostname = "softcrate.de";
        return Response.redirect(url.toString(), 301);
    }

    return context.next();
}
