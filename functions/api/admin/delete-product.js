export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password, slug } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!slug) {
            return new Response(JSON.stringify({ error: 'Missing slug' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Fetch existing products
        let products = await env.LICENSE_KEYS.get('PRODUCTS_LIST', 'json') || [];

        // Filter out the product to delete
        const initialLength = products.length;
        products = products.filter(p => p.slug !== slug);

        if (products.length === initialLength) {
            return new Response(JSON.stringify({ error: 'Product not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Save back to KV
        await env.LICENSE_KEYS.put('PRODUCTS_LIST', JSON.stringify(products));

        // Note: We are NOT deleting the keys associated with the product to prevent accidental data loss of keys.
        // We just remove it from the "Display List".

        return new Response(JSON.stringify({
            success: true,
            message: 'Product deleted'
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to delete product',
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
