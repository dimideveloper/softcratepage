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
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; margin: 0; padding: 0; color: #1d1d1f; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #1d1d1f; text-decoration: none; }
    .logo span { color: #0071e3; }
    .hero-text { font-size: 32px; font-weight: 600; letter-spacing: -0.5px; margin-bottom: 24px; color: #1d1d1f; }
    .intro-text { font-size: 16px; color: #86868b; margin-bottom: 32px; }
    .key-container { background-color: #f5f5f7; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .key-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #86868b; font-weight: 600; margin-bottom: 12px; }
    .license-key { font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 20px; color: #1d1d1f; letter-spacing: 1px; font-weight: 500; user-select: all; }
    .product-info { border-top: 1px solid #e5e5e5; padding-top: 24px; margin-bottom: 32px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
    .info-label { color: #86868b; }
    .info-value { font-weight: 500; }
    .button { display: inline-block; background-color: #0071e3; color: white; padding: 12px 24px; border-radius: 980px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background-color 0.2s; }
    .button:hover { background-color: #0077ed; }
    .footer { border-top: 1px solid #e5e5e5; margin-top: 60px; padding-top: 30px; font-size: 12px; color: #86868b; text-align: center; }
    .instructions { background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 24px; margin-top: 32px; }
    .instructions h3 { margin-top: 0; font-size: 16px; margin-bottom: 12px; }
    .instructions ol { padding-left: 20px; margin: 0; color: #424245; font-size: 14px; }
    .instructions li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Softcrate<span>.</span></div>
    </div>
    
    <div class="hero-text">Vielen Dank für Ihre Bestellung.</div>
    <p class="intro-text">Ihre Zahlung wurde bestätigt. Hier ist Ihr Aktivierungsschlüssel.</p>
    
    <div class="key-container">
      <div class="key-label">Lizenzschlüssel</div>
      <div class="license-key">${assignedKey}</div>
    </div>

    <div class="product-info">
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${env.PRODUCT_NAME || 'Digitales Produkt'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Betrag</span>
        <span class="info-value">${env.PRODUCT_PRICE || '0.00'} ${env.PRODUCT_CURRENCY || 'EUR'}</span>
      </div>
       <div class="info-row">
        <span class="info-label">Bestell-NR</span>
        <span class="info-value">#${orderId.substring(6, 14)}</span>
      </div>
    </div>

    <div class="instructions">
      <h3>Aktivierung</h3>
      <ol>
        <li>Software herunterladen und installieren</li>
        <li>Anwendung starten</li>
        <li>Lizenzschlüssel eingeben wenn aufgefordert</li>
      </ol>
    </div>

    <div style="text-align: center; margin-top: 40px;">
      <a href="mailto:support@softcrate.de" class="button">Support kontaktieren</a>
    </div>

    <div class="footer">
      <p>&copy; 2026 Softcrate Digital Solutions. All rights reserved.</p>
      <p>Heilbronn, Deutschland</p>
    </div>
  </div>
</body>
</html>
                `;
      } else {
        // BACKORDER EMAIL (Minimalist)
        emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; margin: 0; padding: 0; color: #1d1d1f; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { margin-bottom: 40px; }
    .logo { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #1d1d1f; text-decoration: none; }
    .logo span { color: #f5a623; } /* Orange accent for waiting */
    .hero-text { font-size: 32px; font-weight: 600; letter-spacing: -0.5px; margin-bottom: 24px; color: #1d1d1f; }
    .intro-text { font-size: 16px; color: #424245; margin-bottom: 32px; }
    .status-badge { display: inline-block; background-color: #fff8e6; color: #b45309; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 980px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 24px; }
    .info-box { border-left: 3px solid #f5a623; padding-left: 20px; margin-bottom: 32px; color: #424245; }
    .product-info { border-top: 1px solid #e5e5e5; padding-top: 24px; margin-bottom: 32px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
    .info-label { color: #86868b; }
    .info-value { font-weight: 500; }
    .footer { border-top: 1px solid #e5e5e5; margin-top: 60px; padding-top: 30px; font-size: 12px; color: #86868b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Softcrate<span>.</span></div>
    </div>
    
    <div class="status-badge">Wartet auf Zuweisung</div>
    <div class="hero-text">Bestellung bestätigt.</div>
    
    <div class="info-box">
      <p style="margin: 0; font-weight: 500; color: #1d1d1f; margin-bottom: 8px;">Wir bereiten Ihren Key vor.</p>
      <p style="margin: 0; font-size: 14px;">Aufgrund der hohen Nachfrage sind wir gerade am Nachgenerieren von Lizenzen. Sie stehen ganz oben auf der Liste.</p>
    </div>

    <p class="intro-text">
        Sobald Ihr Key bereit ist (in der Regel in weniger als 12 Stunden), senden wir ihn Ihnen <strong>automatisch per E-Mail</strong> zu.
        <br><br>
        Sie müssen nichts weiter tun.
    </p>

    <div class="product-info">
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${env.PRODUCT_NAME || 'Digitales Produkt'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value" style="color: #f5a623;">In Bearbeitung</span>
      </div>
      <div class="info-row">
        <span class="info-label">Bestell-NR</span>
        <span class="info-value">#${orderId.substring(6, 14)}</span>
      </div>
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
