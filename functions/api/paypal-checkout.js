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
            throw new Error('PayPal authentication failed');
        }

        const { access_token } = await authResponse.json();

        // Create PayPal order
        const orderData = {
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: env.PRODUCT_CURRENCY || 'EUR',
                    value: total.toFixed(2)
                },
                description: items.map(item => item.name).join(', '),
                custom_id: JSON.stringify({ email, items }) // Store customer data
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
            const error = await orderResponse.text();
            throw new Error(`PayPal order creation failed: ${error}`);
        }

        const order = await orderResponse.json();

        // Find approval URL
        const approvalUrl = order.links.find(link => link.rel === 'approve')?.href;

        if (!approvalUrl) {
            throw new Error('No approval URL found');
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
            message: error.message
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
