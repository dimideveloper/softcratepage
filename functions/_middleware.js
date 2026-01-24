export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    // 301 Redirect from WWW to NON-WWW
    if (url.hostname.startsWith('www.')) {
        const newHostname = url.hostname.replace('www.', '');
        const newUrl = new URL(request.url);
        newUrl.hostname = newHostname;

        return Response.redirect(newUrl.toString(), 301);
    }

    // Continue to the next middleware or asset
    return next();
}
