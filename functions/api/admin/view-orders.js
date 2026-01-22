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

        if (!env.ORDERS) {
            console.error('KV Error: ORDERS binding missing');
            throw new Error('ORDERS binding is missing in Cloudflare Pages settings');
        }

        // Get all orders
        const ordersList = await env.ORDERS.list();
        const orders = [];

        for (const key of ordersList.keys) {
            const order = await env.ORDERS.get(key.name, 'json');
            if (order) {
                orders.push({
                    id: key.name,
                    ...order
                });
            }
        }

        // Sort by timestamp (newest first)
        orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return new Response(JSON.stringify({
            orders: orders,
            total: orders.length
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('View Orders Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch orders',
            message: error.message || 'Unknown server error',
            name: error.name,
            stack: error.stack,
            binding_status: !!env.ORDERS ? 'present' : 'missing'
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
