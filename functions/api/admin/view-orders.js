export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        if (!env.ORDERS) {
            throw new Error('ORDERS binding is missing');
        }

        // Get all orders
        let ordersList;
        try {
            ordersList = await env.ORDERS.list();
        } catch (e) {
            throw new Error(`Failed to list ORDERS: ${e.message}`);
        }

        const orders = [];

        if (ordersList && ordersList.keys) {
            for (const key of ordersList.keys) {
                try {
                    const order = await env.ORDERS.get(key.name, 'json');
                    if (order) {
                        orders.push({ id: key.name, ...order });
                    }
                } catch (e) {
                    console.error(`Failed to load order ${key.name}:`, e);
                }
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
        return new Response(JSON.stringify({
            error: 'Server Error',
            message: error.message,
            stack: error.stack
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
