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

      const emailHtml = `
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
    
    <div class="hero-text">Ihr Key ist bereit.</div>
    <p class="intro-text">Vielen Dank für Ihre Geduld. Ihre Bestellung wurde soeben fertiggestellt.</p>
    
    <div class="key-container">
      <div class="key-label">Lizenzschlüssel</div>
      <div class="license-key">${assignKey}</div>
    </div>

    <div class="product-info">
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${order.product}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value" style="color: #0071e3;">Ausgeliefert</span>
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
