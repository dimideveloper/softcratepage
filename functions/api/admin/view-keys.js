export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get all products and their keys
        const products = ['windows-11-pro', 'office-2024-ltsc', 'capcut-pro'];
        const inventory = {};

        for (const product of products) {
            const keys = await env.LICENSE_KEYS.get(product, 'json') || [];
            inventory[product] = {
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
