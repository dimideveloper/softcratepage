export async function onRequestPost(context) {
  const { request, env } = context;
  let lastStep = 'start';

  try {
    lastStep = 'parse_body';
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'Invalid JSON body',
        message: 'Der Server hat keine gültigen Daten empfangen. (Empty or Malformed Body)',
        detail: e.message
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { password, product, keys, downloadLink } = body;

    lastStep = 'auth_check';
    if (password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    lastStep = 'param_check';
    if (!product || !keys || !Array.isArray(keys)) {
      return new Response(JSON.stringify({ error: 'Invalid request. Need product and keys array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    lastStep = 'kv_check';
    if (!env.ORDERS || !env.LICENSE_KEYS) {
      throw new Error('KV bindings (ORDERS or LICENSE_KEYS) missing in environment');
    }

    lastStep = 'orders_list';
    const ordersList = await env.ORDERS.list({ limit: 1000 });
    let waitingOrders = [];

    lastStep = 'orders_loop';
    if (ordersList && ordersList.keys) {
      for (const key of ordersList.keys) {
        try {
          const orderData = await env.ORDERS.get(key.name, 'json');
          if (orderData && orderData.product_slug === product && orderData.status === 'waiting_for_stock') {
            waitingOrders.push({ ...orderData, key: key.name });
          }
        } catch (e) {
          console.error(`Skipping invalid order entry: ${key.name}`, e);
        }
      }
    }

    lastStep = 'sort_orders';
    waitingOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let fulfilledOrders = 0;
    let keysArray = [...keys];

    lastStep = 'fulfillment_loop';
    // Fetch dynamic download links from KV
    let DOWNLOAD_LINKS = {
      'office-2024-ltsc': 'https://officecdn.microsoft.com/pr/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/de-de/ProPlus2024Retail.img',
      'office-2024-pro-plus': 'https://officecdn.microsoft.com/pr/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/de-de/ProPlus2024Retail.img',
      'windows-11-pro': 'https://www.microsoft.com/software-download/windows11',
      'windows-10-pro': 'https://www.microsoft.com/software-download/windows10'
    };

    try {
      const kvLinks = await env.LICENSE_KEYS.get('DOWNLOAD_LINKS', 'json') || {};
      DOWNLOAD_LINKS = { ...DOWNLOAD_LINKS, ...kvLinks };
    } catch (e) {
      console.warn('Failed to fetch dynamic DOWNLOAD_LINKS', e);
    }

    for (const order of waitingOrders) {
      if (keysArray.length === 0) break;

      const assignKey = keysArray.shift();
      fulfilledOrders++;

      lastStep = `updating_order_${order.key}`;
      order.license_key = assignKey;
      order.status = 'completed';
      order.fulfillment_date = new Date().toISOString();

      await env.ORDERS.put(order.key, JSON.stringify(order));

      lastStep = `sending_email_${order.key}`;
      if (env.RESEND_API_KEY && order.email) {
        try {
          const downloadLink = DOWNLOAD_LINKS[order.product_slug] || null;

          const emailHtml = `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1d1d1f;">
              <h1 style="font-size: 32px; font-weight: 700;">Ihr Key ist da!</h1>
              <p style="font-size: 16px; color: #86868b;">Vielen Dank für Ihre Geduld. Hier ist Ihr Lizenzschlüssel für <strong>${order.product || order.product_slug}</strong>:</p>
              
              <div style="background: #f5f5f7; border-radius: 12px; padding: 24px; text-align: center; margin: 32px 0;">
                <p style="font-size: 12px; text-transform: uppercase; color: #86868b; margin-bottom: 8px;">Produktschlüssel & Download</p>
                <code style="font-size: 20px; font-weight: 700; color: #0071e3; letter-spacing: 1px;">${assignKey}</code>
                ${downloadLink ? `
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e5e5; display: block;">
                  <a href="${downloadLink}" style="color: #0071e3; text-decoration: none; font-weight: 600; font-size: 15px;">📥 Installer (.exe) herunterladen</a>
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
              subject: '🌟 Ihr Lizenzschlüssel ist da! (' + (order.product || order.product_slug) + ')',
              html: emailHtml
            })
          });
        } catch (e) {
          console.error('Email failed', e);
        }
      }
    }

    lastStep = 'update_stock';
    let existingKeys = [];
    try {
      existingKeys = await env.LICENSE_KEYS.get(product, 'json') || [];
      if (!Array.isArray(existingKeys)) existingKeys = [];
    } catch (e) {
      existingKeys = [];
    }

    const updatedKeys = [...existingKeys, ...keysArray];
    await env.LICENSE_KEYS.put(product, JSON.stringify(updatedKeys));

    // Save/Update Download Link if provided
    if (downloadLink !== undefined) {
      lastStep = 'update_download_link';
      let downloadLinks = {};
      try {
        downloadLinks = await env.LICENSE_KEYS.get('DOWNLOAD_LINKS', 'json') || {};
      } catch (e) {
        console.warn('Failed to fetch DOWNLOAD_LINKS', e);
      }
      downloadLinks[product] = downloadLink;
      await env.LICENSE_KEYS.put('DOWNLOAD_LINKS', JSON.stringify(downloadLinks));
    }

    return new Response(JSON.stringify({
      success: true,
      product: product,
      added_to_stock: keysArray.length,
      fulfilled_backorders: fulfilledOrders
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('AddKeys Critical Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to add keys',
      message: error.message,
      last_step: lastStep,
      stack: error.stack
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
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
