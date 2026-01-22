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

        if (!env.ORDERS) {
            throw new Error('ORDERS binding missing');
        }

        // 1. Fetch ALL orders (limitation of KV list, ideally use D1 or proper DB for scale, but manageable for small shop)
        // Note: efficiently we should store waiting orders in a separate list, but for now we scan.
        // Better approach for KV: Store "waiting_orders_PRODUCT" list.
        // Let's assume we scan recent orders or use a separate key for waiting list. 
        // For simplicity and speed in this artifact without major refactor:
        // We will scan the last 1000 orders.

        const ordersList = await env.ORDERS.list({ limit: 1000 });
        let waitingOrders = [];

        for (const key of ordersList.keys) {
            const orderData = await env.ORDERS.get(key.name, 'json');
            if (orderData && orderData.product_slug === product && orderData.status === 'waiting_for_stock') {
                waitingOrders.push({ ...orderData, key: key.name });
            }
        }

        // Sort FIFO (Oldest first)
        waitingOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        let keysUsed = 0;
        let fulfilledOrders = 0;
        let keysArray = [...keys]; // Copy

        // 2. Fulfill Waiting Orders
        for (const order of waitingOrders) {
            if (keysArray.length === 0) break; // No more keys

            const assignKey = keysArray.shift(); // Take first key
            keysUsed++;
            fulfilledOrders++;

            // Update Order
            order.license_key = assignKey;
            order.status = 'completed';
            order.fulfillment_date = new Date().toISOString();

            // Save updated order
            await env.ORDERS.put(order.key, JSON.stringify(order));

            // Send Email
            if (env.RESEND_API_KEY) {
                const emailHtml = `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <style>
                      body { font-family: 'Inter', Arial, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
                      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                      .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center; }
                      .header h1 { color: white; margin: 0; font-size: 28px; }
                      .content { padding: 40px 30px; }
                      .license-box { background: #f5f5f7; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
                      .license-key { font-size: 24px; font-weight: bold; color: #10b981; letter-spacing: 2px; font-family: 'Courier New', monospace; }
                      .footer { background: #f5f5f7; padding: 20px; text-align: center; font-size: 12px; color: #86868b; }
                      .button { display: inline-block; background: #10b981; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin: 20px 0; }
                    </style>
                  </head>
                  <body>
                    <div class="container">
                      <div class="header">
                        <h1>🌟 Ihr Key ist da!</h1>
                      </div>
                      <div class="content">
                        <p>Hallo,</p>
                        <p>Gute Nachrichten! Wir haben Nachschub erhalten und Ihre Bestellung wurde sofort bearbeitet.</p>
                        <p>Vielen Dank für Ihre Geduld.</p>
                        
                        <div class="license-box">
                          <div style="font-size: 14px; color: #86868b; margin-bottom: 10px;">Ihr Lizenzschlüssel</div>
                          <div class="license-key">${assignKey}</div>
                        </div>

                        <p><strong>Produkt:</strong> ${order.product}</p>

                        <a href="mailto:support@softcrate.de" class="button">Support kontaktieren</a>

                        <p style="margin-top: 30px; font-size: 14px; color: #86868b;">
                          <strong>Aktivierungsanleitung:</strong><br>
                          1. Laden Sie die Software herunter<br>
                          2. Installieren Sie die Software<br>
                          3. Geben Sie den Lizenzschlüssel bei der Aktivierung ein
                        </p>
                      </div>
                      <div class="footer">
                        <p>&copy; 2026 Softcrate Digital Solutions. All rights reserved.</p>
                      </div>
                    </div>
                  </body>
                  </html>
                `;

                try {
                    await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: 'Softcrate <noreply@softcrate.de>',
                            to: [order.email],
                            subject: '🌟 Ihr Lizenzschlüssel ist da! (Softcrate Nachlieferung)',
                            html: emailHtml
                        })
                    });
                } catch (e) {
                    console.error('Failed to send fulfillment email', e);
                }
            }
        }

        // 3. Add remaining keys to stock
        const existingKeys = await env.LICENSE_KEYS.get(product, 'json') || [];
        const updatedKeys = [...existingKeys, ...keysArray];
        await env.LICENSE_KEYS.put(product, JSON.stringify(updatedKeys));

        return new Response(JSON.stringify({
            success: true,
            product: product,
            added_to_stock: keysArray.length,
            fulfilled_backorders: fulfilledOrders,
            total_stock: updatedKeys.length
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
