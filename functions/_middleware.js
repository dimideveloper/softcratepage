export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    // 1. WWW to Non-WWW Redirect
    // Check if we are on www and redirect to root domain immediately
    if (url.hostname.startsWith("www.")) {
        const newUrl = new URL(request.url);
        newUrl.hostname = newUrl.hostname.replace(/^www\./, "");
        return Response.redirect(newUrl.toString(), 301);
    }

    // --- MAINTENANCE MODE LOGIC ---
    const isMaintenance = String(env.MAINTENANCE_MODE) === 'true';
    const maintenanceSecret = env.MAINTENANCE_SECRET;

    // A. Check for Admin Access Link (sets cookie)
    const accessKey = url.searchParams.get('access');
    if (isMaintenance && maintenanceSecret && accessKey === maintenanceSecret) {
        const headers = new Headers();
        headers.append('Set-Cookie', `admin_access=true; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
        // Redirect to a clean path without query params
        const redirectUrl = new URL('/', url.origin);
        headers.set('Location', redirectUrl.toString());
        return new Response(null, { status: 302, headers });
    }

    // B. Check for Admin Cookie
    const cookieString = request.headers.get('Cookie') || '';
    const isAdmin = cookieString.includes('admin_access=true');

    // C. Handle Maintenance Redirects
    if (isMaintenance && !isAdmin) {
        // Exclude static assets and the maintenance page itself from redirects
        const isMaintenanceUrl = pathname === '/maintenance.html' || pathname === '/maintenance';
        const isStaticAsset = /\.(css|js|png|jpg|jpeg|svg|ico|webp|webmanifest|xml)$/i.test(pathname);

        if (!isMaintenanceUrl && !isStaticAsset) {
            // Use 307 (Temporary Redirect) to avoid caching issues and protocol loops
            const maintenanceRedirect = new URL('/maintenance.html', url.origin);
            return Response.redirect(maintenanceRedirect.toString(), 307);
        }
    }

    return next();
}
