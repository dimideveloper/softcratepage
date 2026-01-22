export async function onRequestGet(context) {
    const { env } = context;

    try {
        let products = [];
        try {
            products = await env.LICENSE_KEYS.get('PRODUCTS_LIST', 'json') || [];
        } catch (e) {
            console.warn('Failed to fetch products list', e);
        }

        // Return just the public data
        const publicData = products.map(p => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            price: p.price,
            currency: p.currency,
            imageUrl: p.imageUrl,
            category: p.category || 'other',
            description: p.description || ''
        }));

        return new Response(JSON.stringify(publicData), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=60' // Cache for 60 seconds
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch products' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        }
    });
}
