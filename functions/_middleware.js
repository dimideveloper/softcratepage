export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // 1. WWW to Non-WWW Redirect
    if (url.hostname === "www.softcrate.de") {
        url.hostname = "softcrate.de";
        return Response.redirect(url.toString(), 301);
    }

    // --- MAINTENANCE MODE LOGIC ---
    const isMaintenance = env.MAINTENANCE_MODE === 'true';
    const maintenanceSecret = env.MAINTENANCE_SECRET;

    // A. Check for Admin Access Link (sets cookie)
    if (isMaintenance && maintenanceSecret && url.searchParams.get('access') === maintenanceSecret) {
        const headers = new Headers();
        headers.append('Set-Cookie', `admin_access=true; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`);
        headers.set('Location', '/');
        return new Response(null, { status: 302, headers });
    }

    // B. Check for Admin Cookie
    const cookie = request.headers.get('Cookie') || '';
    const isAdmin = cookie.includes('admin_access=true');

    // C. Handle Maintenance Redirects
    if (isMaintenance && !isAdmin) {
        // Allow static assets and the maintenance page
        const isStatic = /\.(css|js|png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname);
        const isMaintenancePage = url.pathname === '/maintenance.html';

        if (!isStatic && !isMaintenancePage) {
            return Response.redirect(`${url.origin}/maintenance.html`, 302);
        }
    }

    return next();
}
