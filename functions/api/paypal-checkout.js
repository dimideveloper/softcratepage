export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { email, items } = body;

        // Validate input
        if (!email || !items || items.length === 0) {
            return new Response(JSON.stringify({ error: 'Invalid request' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Calculate total
        const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // PayPal API credentials
        const PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID;
        const PAYPAL_SECRET = env.PAYPAL_SECRET;

        // Validate PayPal credentials
        if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
            return new Response(JSON.stringify({
                error: 'PayPal configuration error',
                message: 'PAYPAL_CLIENT_ID or PAYPAL_SECRET not set in environment variables'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const PAYPAL_MODE = env.PAYPAL_MODE || 'live'; // Default to live
        const PAYPAL_API = PAYPAL_MODE === 'sandbox'
            ? 'https://api-m.sandbox.paypal.com'
            : 'https://api-m.paypal.com';

        // Get PayPal access token
        const authResponse = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'en_US',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`)}`
            },
            body: 'grant_type=client_credentials'
        });

        if (!authResponse.ok) {
            const authError = await authResponse.text();
            throw new Error(`PayPal authentication failed (${authResponse.status}): ${authError}`);
        }

        const { access_token } = await authResponse.json();

        // Prepare custom_id
        let customId = JSON.stringify({ email, items });

        // PayPal custom_id limit is 127 characters. 
        // If it's too long, we store it in KV and pass the KV key.
        if (customId.length > 120) {
            const tempId = `checkout_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            if (env.ORDERS) {
                // Store with 3 hour expiration (Cloudflare KV put option: expirationTtl in seconds)
                await env.ORDERS.put(`temp_checkout_${tempId}`, customId, { expirationTtl: 10800 });
                customId = `kv:${tempId}`;
            } else {
                console.warn('ORDERS KV not bound, cannot use fallback for long custom_id');
                // Fallback: try to truncate items if KV is missing (not ideal but better than crash)
                customId = JSON.stringify({ email, items: items.map(i => ({ n: i.name.substring(0, 10), s: i.slug })) }).substring(0, 127);
            }
        }

        // Create PayPal order
        const orderData = {
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: env.PRODUCT_CURRENCY || 'EUR',
                    value: total.toFixed(2)
                },
                description: items.map(item => item.name).join(', ').substring(0, 127),
                custom_id: customId
            }],
            application_context: {
                brand_name: 'Softcrate',
                landing_page: 'NO_PREFERENCE',
                user_action: 'PAY_NOW',
                return_url: `${env.SUCCESS_URL || 'https://softcrate.de/danke.html'}`,
                cancel_url: `${env.CANCEL_URL || 'https://softcrate.de/fehler.html'}`
            }
        };

        const orderResponse = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify(orderData)
        });

        if (!orderResponse.ok) {
            const error = await orderResponse.json();
            throw new Error(`PayPal API Error: ${JSON.stringify(error)}`);
        }

        const order = await orderResponse.json();

        // Find approval URL
        const approvalUrl = order.links.find(link => link.rel === 'approve')?.href;

        if (!approvalUrl) {
            throw new Error('No approval URL found in PayPal response');
        }

        return new Response(JSON.stringify({
            approval_url: approvalUrl,
            order_id: order.id
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('PayPal checkout error:', error);
        return new Response(JSON.stringify({
            error: 'Checkout failed',
            message: error.message,
            debug: error.stack // Add stack for easier debugging during fix verification
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle CORS preflight
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
