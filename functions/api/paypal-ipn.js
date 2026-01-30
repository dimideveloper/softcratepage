export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // Parse IPN data from PayPal
        const formData = await request.formData();
        const ipnData = {};
        for (const [key, value] of formData.entries()) {
            ipnData[key] = value;
        }

        console.log('IPN received:', ipnData);

        // Step 1: Verify IPN with PayPal
        const verifyUrl = env.PAYPAL_MODE === 'sandbox'
            ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr'
            : 'https://ipnpb.paypal.com/cgi-bin/webscr';

        const verifyBody = new URLSearchParams({ cmd: '_notify-validate', ...ipnData });

        const verifyResponse = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: verifyBody.toString()
        });

        const verifyText = await verifyResponse.text();

        if (verifyText !== 'VERIFIED') {
            console.error('IPN verification failed:', verifyText);
            return new Response('IPN verification failed', { status: 400 });
        }

        console.log('IPN verified successfully');

        // Step 2: Check payment status
        const paymentStatus = ipnData.payment_status;
        if (paymentStatus !== 'Completed') {
            console.log(`Payment status is ${paymentStatus}, not processing`);
            return new Response('OK', { status: 200 });
        }

        // Step 3: Extract order data
        const customId = ipnData.custom;
        const txnId = ipnData.txn_id;
        const payerEmail = ipnData.payer_email;
        const mcGross = parseFloat(ipnData.mc_gross);

        if (!customId) {
            console.error('No custom_id in IPN');
            return new Response('No custom_id', { status: 400 });
        }

        // Step 4: Retrieve order data
        let orderData;
        if (customId.startsWith('kv:')) {
            // Data was stored in KV due to length
            const kvKey = customId.replace('kv:', '');
            const storedData = await env.ORDERS.get(`temp_checkout_${kvKey}`);
            if (!storedData) {
                console.error('KV data not found for:', kvKey);
                return new Response('Order data not found', { status: 404 });
            }
            orderData = JSON.parse(storedData);
        } else {
            // Data was passed directly
            orderData = JSON.parse(customId);
        }

        const { email, items } = orderData;

        // Step 5: Check if already processed (prevent duplicate)
        const existingOrders = await env.ORDERS.list({ prefix: 'order_' });
        for (const key of existingOrders.keys) {
            const order = await env.ORDERS.get(key.name, 'json');
            if (order && order.paypal_txn_id === txnId) {
                console.log('Order already processed for txn_id:', txnId);
                return new Response('Already processed', { status: 200 });
            }
        }

        // Step 6: Verify amount
        const expectedTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (Math.abs(mcGross - expectedTotal) > 0.01) {
            console.error(`Amount mismatch: expected ${expectedTotal}, got ${mcGross}`);
            return new Response('Amount mismatch', { status: 400 });
        }

        // Step 7: Create order in KV
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const orderNumber = `ORD-PP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        const order = {
            order_number: orderNumber,
            email: email,
            customer_name: ipnData.first_name ? `${ipnData.first_name} ${ipnData.last_name}` : 'PayPal Kunde',
            product: items[0].name + (items.length > 1 ? ` (+${items.length - 1} weitere)` : ''),
            items: items,
            amount: mcGross.toFixed(2),
            currency: ipnData.mc_currency || 'EUR',
            timestamp: new Date().toISOString(),
            status: 'pending',
            payment_method: 'paypal',
            paypal_txn_id: txnId,
            payer_email: payerEmail
        };

        // Step 8: Auto-fulfill if we have keys
        const productSlug = items[0].slug || items[0].name.toLowerCase().replace(/\s+/g, '-');
        const keys = await env.LICENSE_KEYS.get(productSlug, 'json') || [];

        if (keys.length > 0) {
            // Assign key
            const assignedKey = keys.shift();
            await env.LICENSE_KEYS.put(productSlug, JSON.stringify(keys));

            order.license_key = assignedKey;
            order.status = 'completed';
            order.fulfillment_date = new Date().toISOString();

            // Get download link
            let downloadLink = null;
            try {
                const downloadLinks = await env.LICENSE_KEYS.get('DOWNLOAD_LINKS', 'json') || {};
                downloadLink = downloadLinks[productSlug] || null;
            } catch (e) {
                console.error('Error fetching download links:', e);
            }

            // Send email
            if (env.RESEND_API_KEY) {
                const emailHtml = `
                <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1d1d1f;">
                  <h1 style="font-size: 32px; font-weight: 700;">Ihr Key ist da!</h1>
                  <p style="font-size: 16px; color: #86868b;">Vielen Dank für Ihre Bestellung. Hier ist Ihr Lizenzschlüssel für <strong>${items[0].name}</strong>:</p>
                  
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
                        to: [email],
                        subject: '🌟 Ihr Lizenzschlüssel ist da! (' + items[0].name + ')',
                        html: emailHtml
                    })
                });

                console.log('Email sent to:', email);
            }
        } else {
            // No keys available, mark as waiting
            order.status = 'waiting_for_stock';
            console.log('No keys available for product:', productSlug);
        }

        // Step 9: Save order
        await env.ORDERS.put(orderId, JSON.stringify(order));
        console.log('Order saved:', orderId);

        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error('IPN processing error:', error);
        return new Response('Internal error', { status: 500 });
    }
}

export async function onRequestGet() {
    return new Response('PayPal IPN endpoint', { status: 200 });
}
