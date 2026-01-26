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

    const { password, product, keys } = body;

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
          // Construct basic HTML for speed/safety
          const emailHtml = `<h1>Key Ready</h1><p>Product: ${order.product || order.product_slug}</p><p>Key: ${assignKey}</p>`;

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Softcrate <noreply@softcrate.de>',
              to: [order.email],
              subject: '🌟 Ihr Lizenzschlüssel ist da!',
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
