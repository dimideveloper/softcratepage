export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password, name, slug, price, currency, imageUrl, category, description, content_sections } = body;

        // Check admin password
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!name || !slug || !imageUrl) {
            return new Response(JSON.stringify({ error: 'Missing required fields: name, slug, or imageUrl' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Fetch existing products
        const products = await env.LICENSE_KEYS.get('PRODUCTS_LIST', 'json') || [];

        // Check if slug exists
        if (products.some(p => p.slug === slug)) {
            return new Response(JSON.stringify({ error: 'Product with this slug already exists' }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Add new product
        const newProduct = {
            id: Date.now().toString(),
            name,
            slug,
            price: price || '0.00',
            currency: currency || 'EUR',
            imageUrl: imageUrl,
            category: category || 'other',
            description: description || '',
            content_sections: content_sections || [], // Save templates
            createdAt: new Date().toISOString()
        };

        products.push(newProduct);

        // Save back to KV
        await env.LICENSE_KEYS.put('PRODUCTS_LIST', JSON.stringify(products));

        return new Response(JSON.stringify({
            success: true,
            product: newProduct
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to create product',
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
