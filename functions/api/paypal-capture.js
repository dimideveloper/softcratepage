export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json();
        const { orderID, email } = body;

        if (!orderID) {
            return new Response(JSON.stringify({ error: 'Missing orderID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!email) {
            return new Response(JSON.stringify({ error: 'Missing email' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // PayPal API credentials
        const PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID;
        const PAYPAL_SECRET = env.PAYPAL_SECRET;
        const PAYPAL_MODE = env.PAYPAL_MODE || 'live'; // Default to live
        const PAYPAL_API = PAYPAL_MODE === 'sandbox'
            ? 'https://api-m.sandbox.paypal.com'
            : 'https://api-m.paypal.com';

        // Get access token
        const authResponse = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`)}`
            },
            body: 'grant_type=client_credentials'
        });

        const { access_token } = await authResponse.json();

        // Capture the order
        const captureResponse = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`
            }
        });

        const captureData = await captureResponse.json();

        if (captureData.status === 'COMPLETED') {
            // Use email from request body
            const customerEmail = email;

            // Determine product from cart (you can enhance this logic)
            const productSlug = env.PRODUCT_SLUG || 'windows-11-pro';

            // Get available keys from KV
            const availableKeys = await env.LICENSE_KEYS.get(productSlug, 'json') || [];

            let assignedKey = null;
            let orderStatus = 'waiting_for_stock';
            let emailSubject = '📦 Wir haben Ihre Bestellung erhalten (Warteliste)';
            let emailHtml = '';

            if (availableKeys.length > 0) {
                // Key available - assign immediately
                assignedKey = availableKeys.shift();
                await env.LICENSE_KEYS.put(productSlug, JSON.stringify(availableKeys));
                orderStatus = 'completed';
                emailSubject = '🎉 Ihre Softcrate Bestellung - Lizenzschlüssel';
            }

            // Save order to KV
            const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await env.ORDERS.put(orderId, JSON.stringify({
                email: customerEmail,
                product: env.PRODUCT_NAME || 'Digital Product',
                product_slug: productSlug,
                license_key: assignedKey, // null if waiting
                paypal_transaction_id: orderID,
                amount: env.PRODUCT_PRICE || '0.00',
                currency: env.PRODUCT_CURRENCY || 'EUR',
                timestamp: new Date().toISOString(),
                status: orderStatus
            }));

            // Prepare Email Content based on status
            if (orderStatus === 'completed') {
                emailHtml = `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <style>
                      body { font-family: 'Inter', Arial, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
                      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                      .header { background: linear-gradient(135deg, #0071e3 0%, #0051a8 100%); padding: 40px 20px; text-align: center; }
                      .header h1 { color: white; margin: 0; font-size: 28px; }
                      .content { padding: 40px 30px; }
                      .license-box { background: #f5f5f7; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
                      .license-key { font-size: 24px; font-weight: bold; color: #0071e3; letter-spacing: 2px; font-family: 'Courier New', monospace; }
                      .footer { background: #f5f5f7; padding: 20px; text-align: center; font-size: 12px; color: #86868b; }
                      .button { display: inline-block; background: #0071e3; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin: 20px 0; }
                    </style>
                  </head>
                  <body>
                    <div class="container">
                      <div class="header">
                        <h1>🎉 Vielen Dank für Ihre Bestellung!</h1>
                      </div>
                      <div class="content">
                        <p>Hallo,</p>
                        <p>Ihre Zahlung war erfolgreich! Hier ist Ihr Lizenzschlüssel:</p>
                        
                        <div class="license-box">
                          <div style="font-size: 14px; color: #86868b; margin-bottom: 10px;">Ihr Lizenzschlüssel</div>
                          <div class="license-key">${assignedKey}</div>
                        </div>

                        <p><strong>Produkt:</strong> ${env.PRODUCT_NAME || 'Digitales Produkt'}</p>
                        <p><strong>Preis:</strong> ${env.PRODUCT_PRICE || '0.00'} ${env.PRODUCT_CURRENCY || 'EUR'}</p>

                        <p>Bei Fragen stehen wir Ihnen gerne zur Verfügung:</p>
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
                        <p>Lukas Schneider | Liebermann Straße 2 | 74078 Heilbronn</p>
                      </div>
                    </div>
                  </body>
                  </html>
                `;
            } else {
                // BACKORDER EMAIL
                emailHtml = `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <style>
                      body { font-family: 'Inter', Arial, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
                      .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                      .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 20px; text-align: center; }
                      .header h1 { color: white; margin: 0; font-size: 28px; }
                      .content { padding: 40px 30px; }
                      .info-box { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 20px; margin: 20px 0; color: #92400e; }
                      .footer { background: #f5f5f7; padding: 20px; text-align: center; font-size: 12px; color: #86868b; }
                      .button { display: inline-block; background: #1d1d1f; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin: 20px 0; }
                    </style>
                  </head>
                  <body>
                    <div class="container">
                      <div class="header">
                        <h1>📦 Bestellung erhalten</h1>
                      </div>
                      <div class="content">
                        <p>Hallo,</p>
                        <p>Vielen Dank für Ihre Bestellung. Ihre Zahlung war erfolgreich.</p>
                        
                        <div class="info-box">
                          <strong>Aktuell hohe Nachfrage:</strong><br>
                          Aufgrund der extrem hohen Nachfrage bereiten wir gerade neue Lizenzschlüssel für dieses Produkt vor.
                        </div>

                        <p><strong>Was passiert jetzt?</strong></p>
                        <p>Sie befinden sich oben auf unserer Prioritätsliste. Sobald die neuen Schlüssel im System sind (in der Regel innerhalb weniger Stunden), erhalten Sie Ihren Key <strong>automatisch per E-Mail</strong>.</p>
                        
                        <p>Sie müssen nichts weiter tun.</p>

                        <p><strong>Produkt:</strong> ${env.PRODUCT_NAME || 'Digitales Produkt'}</p>
                        <p><strong>Status:</strong> <span style="color: #d97706; font-weight: bold;">Wartet auf Zuweisung</span></p>

                        <a href="mailto:support@softcrate.de" class="button">Support kontaktieren</a>
                      </div>
                      <div class="footer">
                        <p>&copy; 2026 Softcrate Digital Solutions. All rights reserved.</p>
                      </div>
                    </div>
                  </body>
                  </html>
                `;
            }

            // Send email with license key via Resend
            if (env.RESEND_API_KEY && customerEmail) {
                const emailResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'Softcrate <noreply@softcrate.de>',
                        to: [customerEmail],
                        subject: emailSubject,
                        html: emailHtml
                    })
                });

                const emailResult = await emailResponse.json();

                if (!emailResponse.ok) {
                    console.error('Resend API error:', emailResult);
                    // Don't fail the request, just log it. Order is saved.
                } else {
                    console.log('Email sent successfully:', emailResult);
                }
            }

            return new Response(JSON.stringify({
                status: orderStatus,
                message: orderStatus === 'completed' ? 'Payment completed and key sent' : 'Ordered placed, waiting for stock',
                orderId: orderId
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        return new Response(JSON.stringify({
            status: 'pending',
            message: 'Payment not completed yet'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('PayPal capture error:', error);
        return new Response(JSON.stringify({
            error: 'Capture failed',
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
