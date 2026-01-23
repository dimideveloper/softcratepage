export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password } = body;

        // Check admin password
        if (!env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'System configuration error: ADMIN_PASSWORD not set' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get all products and their keys
        // Get all products and their keys
        const defaultProducts = ['windows-11-pro', 'office-2024-ltsc', 'capcut-pro'];

        let customProducts = [];
        try {
            customProducts = await env.LICENSE_KEYS.get('PRODUCTS_LIST', 'json') || [];
        } catch (e) {
            console.warn('Failed to fetch custom products', e);
        }

        const productSlugs = [...new Set([...defaultProducts, ...customProducts.map(p => p.slug)])];
        const inventory = {};

        if (!env.LICENSE_KEYS) {
            console.error('KV Error: LICENSE_KEYS binding missing');
            throw new Error('LICENSE_KEYS binding is missing in Cloudflare Pages settings');
        }

        for (const slug of productSlugs) {
            const keys = await env.LICENSE_KEYS.get(slug, 'json') || [];
            // Try to find metadata
            const metadata = customProducts.find(p => p.slug === slug) || { name: slug };

            inventory[slug] = {
                name: metadata.name,
                available: keys.length,
                keys: keys
            };
        }

        return new Response(JSON.stringify(inventory), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to fetch keys',
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        }
    });
}
