export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { password, orderId, newStatus } = body;

    // Check admin password
    if (!env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'System configuration error: ADMIN_PASSWORD missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Incorrect password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!orderId || !newStatus) {
      return new Response(JSON.stringify({ error: 'Missing orderId or newStatus' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get the order
    const orderData = await env.ORDERS.get(orderId, 'json');
    if (!orderData) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update status
    const oldStatus = orderData.status;
    orderData.status = newStatus;
    orderData.status_updated_at = new Date().toISOString();

    // Save updated order
    await env.ORDERS.put(orderId, JSON.stringify(orderData));

    // Send email notification based on new status
    let emailSent = false;
    if (env.RESEND_API_KEY && orderData.email) {
      let emailSubject = '';
      let emailHtml = '';

      switch (newStatus) {
        case 'refunded':
          emailSubject = '💰 Rückerstattung bestätigt - Softcrate';
          emailHtml = generateRefundEmail(orderData);
          break;
        case 'cancelled':
          emailSubject = '❌ Bestellung storniert - Softcrate';
          emailHtml = generateCancellationEmail(orderData);
          break;
        case 'completed':
          if (orderData.license_key) {
            emailSubject = '🎉 Ihr Lizenzschlüssel ist da - Softcrate';
            emailHtml = generateDeliveryEmail(orderData);
          }
          break;
      }

      if (emailSubject && emailHtml) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Softcrate <noreply@softcrate.de>',
              to: [orderData.email],
              subject: emailSubject,
              html: emailHtml
            })
          });
          emailSent = true;
        } catch (e) {
          console.error('Failed to send email', e);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      order: orderData,
      emailSent
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to update order status',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function generateRefundEmail(order) {
  return `
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
    .status-badge { display: inline-block; background-color: #f0fdf4; color: #15803d; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 980px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 24px; }
    .info-box { background-color: #f5f5f7; border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .product-info { border-top: 1px solid #e5e5e5; padding-top: 24px; margin-bottom: 32px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
    .info-label { color: #86868b; }
    .info-value { font-weight: 500; }
    .footer { border-top: 1px solid #e5e5e5; margin-top: 60px; padding-top: 30px; font-size: 12px; color: #86868b; text-align: center; }
    .button { display: inline-block; background-color: #0071e3; color: white; padding: 12px 24px; border-radius: 980px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background-color 0.2s; }
    .button:hover { background-color: #0077ed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Softcrate<span>.</span></div>
    </div>
    
    <div class="status-badge">Rückerstattung</div>
    <div class="hero-text">Ihre Bestellung wurde storniert.</div>
    <p class="intro-text">Der Betrag wird in Kürze auf Ihr PayPal-Konto zurückerstattet.</p>
    
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Bestellnummer</span>
        <span class="info-value">${order.order_number || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${order.product}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Betrag</span>
        <span class="info-value">${order.amount} ${order.currency}</span>
      </div>
    </div>

    <p class="intro-text">
      Die Rückerstattung kann 3-5 Werktage dauern, bis sie auf Ihrem Konto erscheint.
      <br><br>
      Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.
    </p>

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
}

function generateCancellationEmail(order) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #ffffff; margin: 0; padding: 0; color: #1d1d1f; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .logo { font-size: 24px; font-weight: 700; color: #1d1d1f; margin-bottom: 40px; }
    .logo span { color: #0071e3; }
    .hero { font-size: 32px; font-weight: 600; margin-bottom: 24px; }
    .content { font-size: 16px; color: #86868b; line-height: 1.6; margin-bottom: 32px; }
    .info-box { background-color: #f5f5f7; border-radius: 12px; padding: 24px; margin-bottom: 32px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
    .info-label { color: #86868b; }
    .info-value { font-weight: 500; }
    .footer { border-top: 1px solid #e5e5e5; margin-top: 60px; padding-top: 30px; font-size: 12px; color: #86868b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Softcrate<span>.</span></div>
    <div class="hero">Bestellung storniert</div>
    <p class="content">Ihre Bestellung wurde storniert.</p>
    
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Bestellnummer</span>
        <span class="info-value">${order.order_number || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${order.product}</span>
      </div>
    </div>

    <p class="content">Bei Fragen kontaktieren Sie uns unter support@softcrate.de</p>

    <div class="footer">
      <p>&copy; 2026 Softcrate Digital Solutions</p>
    </div>
  </div>
</body>
</html>
    `;
}

function generateDeliveryEmail(order) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #ffffff; margin: 0; padding: 0; color: #1d1d1f; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .logo { font-size: 24px; font-weight: 700; color: #1d1d1f; margin-bottom: 40px; }
    .logo span { color: #0071e3; }
    .hero { font-size: 32px; font-weight: 600; margin-bottom: 24px; }
    .content { font-size: 16px; color: #86868b; line-height: 1.6; margin-bottom: 32px; }
    .key-container { background-color: #f5f5f7; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .key-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #86868b; font-weight: 600; margin-bottom: 12px; }
    .license-key { font-family: 'SF Mono', monospace; font-size: 20px; color: #1d1d1f; letter-spacing: 1px; font-weight: 500; }
    .footer { border-top: 1px solid #e5e5e5; margin-top: 60px; padding-top: 30px; font-size: 12px; color: #86868b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Softcrate<span>.</span></div>
    <div class="hero">Ihr Lizenzschlüssel ist da!</div>
    <p class="content">Ihre Bestellung wurde bearbeitet. Hier ist Ihr Aktivierungsschlüssel.</p>
    
    <div class="key-container">
      <div class="key-label">Lizenzschlüssel</div>
      <div class="license-key">${order.license_key}</div>
    </div>

    <p class="content">Bestellnummer: ${order.order_number || 'N/A'}</p>

    <div class="footer">
      <p>&copy; 2026 Softcrate Digital Solutions</p>
    </div>
  </div>
</body>
</html>
    `;
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
