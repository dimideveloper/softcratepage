export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { password, orderId, product } = body;

        // Auth
        if (password !== env.ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        if (!orderId || !product) {
            return new Response(JSON.stringify({ error: 'Missing orderId or product' }), { status: 400 });
        }

        // Get order
        const order = await env.ORDERS.get(orderId, 'json');
        if (!order) {
            return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 });
        }

        // Get keys for the selected product
        const keys = await env.LICENSE_KEYS.get(product, 'json') || [];
        if (keys.length === 0) {
            return new Response(JSON.stringify({ error: 'Keine Keys im Lager für dieses Produkt' }), { status: 400 });
        }

        // Assign key
        const assignedKey = keys.shift();
        await env.LICENSE_KEYS.put(product, JSON.stringify(keys));

        // Update order
        order.license_key = assignedKey;
        order.status = 'completed';
        order.fulfillment_date = new Date().toISOString();
        order.manual_fulfillment_product = product; // Track if fulfilled with different product

        await env.ORDERS.put(orderId, JSON.stringify(order));

        // Send Email
        if (env.RESEND_API_KEY && order.email) {
            // Get download link for the ASSIGNED product
            let downloadLink = null;
            try {
                const downloadLinks = await env.LICENSE_KEYS.get('DOWNLOAD_LINKS', 'json') || {};
                downloadLink = downloadLinks[product] || null;
            } catch (e) { }

            const emailHtml = `
        <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1d1d1f;">
          <h1 style="font-size: 32px; font-weight: 700;">Ihr Key ist da!</h1>
          <p style="font-size: 16px; color: #86868b;">Vielen Dank für Ihre Bestellung. Hier ist Ihr Lizenzschlüssel für <strong>${order.product || product}</strong>:</p>
          
          <div style="background: #f5f5f7; border-radius: 12px; padding: 24px; text-align: center; margin: 32px 0;">
            <p style="font-size: 12px; text-transform: uppercase; color: #86868b; margin-bottom: 8px;">Produktschlüssel & Download</p>
            <code style="font-size: 20px; font-weight: 700; color: #0071e3; letter-spacing: 1px;">${assignedKey}</code>
            ${downloadLink ? `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e5e5; display: block;">
              <a href="${downloadLink}" style="color: #0071e3; text-decoration: none; font-weight: 600; font-size: 15px;">📥 Installer herunterladen</a>
            </div>
            ` : ''}
          </div>

          <p style="font-size: 12px; color: #86868b; text-align: center; margin-top: 60px;">&copy; 2026 Softcrate Digital Solutions</p>
        </div>
      `;

            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Softcrate <noreply@softcrate.de>',
                    to: [order.email],
                    subject: '🌟 Ihr Lizenzschlüssel ist da! (' + (order.product || product) + ')',
                    html: emailHtml
                })
            });
        }

        return new Response(JSON.stringify({ success: true }));

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
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
