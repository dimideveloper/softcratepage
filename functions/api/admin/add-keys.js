export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password, product, keys } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!product || !keys || !Array.isArray(keys)) {
            return new Response(JSON.stringify({ error: 'Invalid request. Need product and keys array' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get existing keys or create new array
        const existingKeys = await env.LICENSE_KEYS.get(product, 'json') || [];

        // Add new keys
        const updatedKeys = [...existingKeys, ...keys];

        // Save to KV
        await env.LICENSE_KEYS.put(product, JSON.stringify(updatedKeys));

        return new Response(JSON.stringify({
            success: true,
            product: product,
            added: keys.length,
            total: updatedKeys.length
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to add keys',
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
