export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { email, amazonCode, voucherType, items } = body;

        if (!email || !amazonCode || !items || items.length === 0) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const type = voucherType || 'amazon'; // Fallback
        const typeLabels = {
            amazon: 'Amazon Gutschein',
            psc: 'Paysafecard PIN',
            apple: 'Apple Gift Card',
            google: 'Google Play Code'
        };
        const typeLabel = typeLabels[type] || 'Gutschein';

        // 1. Create Order Number
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const prefix = type.toUpperCase().slice(0, 3);
        const orderNumber = `ORD-${prefix}-${dateStr}-${randomNum}`;
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 2. Calculate Total Amount
        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);
        const productName = items[0].name + (items.length > 1 ? ` (+${items.length - 1} weitere)` : '');

        // 3. Save Pending Order to KV
        const orderData = {
            order_number: orderNumber,
            email: email,
            customer_name: `${typeLabel} Kunde`,
            product: productName,
            items: items,
            amazon_code: amazonCode, // We reuse this field for any voucher code
            voucher_type: type,
            amount: totalAmount,
            currency: 'EUR',
            timestamp: now.toISOString(),
            status: 'pending_amazon', // Keep status unified for now to reuse admin UI logic
            payment_method: type
        };

        await env.ORDERS.put(orderId, JSON.stringify(orderData));

        // 4. Send Email to Admin (for verification)
        if (env.RESEND_API_KEY) {
            const adminEmailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #0071e3;">Neuer ${typeLabel} erhalten</h2>
          <p>Es wurde eine neue Bestellung mit <strong>${typeLabel}</strong> aufgegeben.</p>
          
          <div style="background: #f5f5f7; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 12px; color: #666; text-transform: uppercase;">Gutscheincode / PIN:</p>
            <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: bold; color: #333; letter-spacing: 1px;">${amazonCode}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Bestellung:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">${orderNumber}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Zahlungsart:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #0071e3; font-weight: bold;">${typeLabel}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Kunde:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Betrag:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${totalAmount} EUR</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Produkt:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${productName}</td></tr>
          </table>

          <p style="margin-top: 30px;">
            <a href="https://softcrate.de/admin.html" style="background: #0071e3; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Bestellung im Dashboard prüfen</a>
          </p>
        </div>
      `;

            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Softcrate Admin <noreply@softcrate.de>',
                    to: ['softcrate.team@gmail.com'],
                    subject: `[${type.toUpperCase()}] ${totalAmount}€ - ${orderNumber}`,
                    html: adminEmailHtml
                })
            });
        }

        return new Response(JSON.stringify({
            success: true,
            orderId: orderId,
            message: 'Code wurde erfolgreich übermittelt'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Voucher checkout error:', error);
        return new Response(JSON.stringify({ error: 'Server error', message: error.message }), {
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
