export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password, product, keyString } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!product || !keyString) {
            return new Response(JSON.stringify({ error: 'Missing product or keyString' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!env.LICENSE_KEYS) {
            throw new Error('LICENSE_KEYS binding missing');
        }

        // 1. Fetch current keys
        const keys = await env.LICENSE_KEYS.get(product, 'json') || [];

        // 2. Filter out the specific key
        const updatedKeys = keys.filter(k => k !== keyString);

        if (keys.length === updatedKeys.length) {
            return new Response(JSON.stringify({ error: 'Key not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 3. Save back to KV
        await env.LICENSE_KEYS.put(product, JSON.stringify(updatedKeys));

        return new Response(JSON.stringify({
            success: true,
            product: product,
            remaining: updatedKeys.length
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to delete key',
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
