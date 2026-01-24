// Global middleware for all routes
export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // --- MAINTENANCE MODE LOGIC ---
    const isMaintenance = env.MAINTENANCE_MODE === 'true';
    const maintenanceSecret = env.MAINTENANCE_SECRET; // e.g., "mysupersecret"

    // 1. Check for Admin Access Link (sets cookie)
    if (isMaintenance && maintenanceSecret && url.searchParams.get('access') === maintenanceSecret) {
        // Set admin cookie and redirect to remove query param
        const headers = new Headers();
        headers.append('Set-Cookie', `admin_access=true; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`); // 1 hour access
        headers.set('Location', '/'); // Go to homepage
        return new Response(null, { status: 302, headers });
    }

    // 2. Check for Admin Cookie
    const cookie = request.headers.get('Cookie') || '';
    const isAdmin = cookie.includes('admin_access=true');

    // 3. Handle Maintenance Redirects
    if (isMaintenance && !isAdmin) {
        // Allow static assets (images, css, js) and the maintenance page itself
        const isStatic = /\.(css|js|png|jpg|jpeg|svg|ico)$/.test(url.pathname);
        const isMaintenancePage = url.pathname === '/maintenance.html';

        if (!isStatic && !isMaintenancePage) {
            // Rewrite request to maintenance page (internal redirect)
            // Or use Response.redirect for external, but rewrite is smoother for users
            // However, for simplicity with static pages, we'll return the maintenance page content.
            // But usually, fetching the static asset internally is best.
            // Let's redirect to /maintenance.html so the URL shows it (good for SEO - 503 handling would be better but simple page is requested)
            return Response.redirect(`${url.origin}/maintenance.html`, 302);
        }
    }

    // --- CORS LOGIC (Modified to wrap next()) ---

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "86400",
            },
        });
    }

    // Continue to the actual function
    const response = await next();

    // Add CORS headers to the response
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}
