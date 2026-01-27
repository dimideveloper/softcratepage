import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

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

      let productName = 'Digital Product';
      let productSlug = 'windows-11-pro';
      let productPrice = '0.00';
      let productCurrency = 'EUR';
      let itemAttributes = null;
      let customerName = 'Kunde';
      let customerAddress = null;

      try {
        let purchaseUnit = captureData.purchase_units?.[0];

        // If capture response is missing structure, or we want to be extra safe,
        // we can fetch the full order details from PayPal
        if (!purchaseUnit?.custom_id && !purchaseUnit?.description) {
          console.log('Capture response missing product info, fetching full order details...');
          const orderResponse = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${access_token}`,
              'Content-Type': 'application/json'
            }
          });
          if (orderResponse.ok) {
            const fullOrder = await orderResponse.json();
            purchaseUnit = fullOrder.purchase_units?.[0] || purchaseUnit;
          }
        }

        if (purchaseUnit?.custom_id) {
          try {
            const customData = JSON.parse(purchaseUnit.custom_id);
            if (customData.items && customData.items.length > 0) {
              const firstItem = customData.items[0];
              productName = firstItem.name || productName;
              // Ensure we use the slug from checkout if available
              productSlug = firstItem.slug || firstItem.name?.toLowerCase().replace(/\s+/g, '-') || productSlug;
              productPrice = firstItem.price?.toString() || productPrice;
              itemAttributes = firstItem.attributes || null;
            }
          } catch (pe) {
            console.warn('Failed to parse custom_id, using description as fallback');
            productName = purchaseUnit.description || productName;
            productSlug = purchaseUnit.description?.toLowerCase().replace(/\s+/g, '-') || productSlug;
          }
        } else if (purchaseUnit?.description) {
          productName = purchaseUnit.description;
          productSlug = purchaseUnit.description.toLowerCase().replace(/\s+/g, '-');
        }

        // Final slug correction: if it's "office-2024-professional-plus-ltsc", map it to "office-2024-ltsc"
        if (productSlug === 'office-2024-professional-plus-ltsc') {
          productSlug = 'office-2024-ltsc';
        }

        if (purchaseUnit?.amount) {
          productCurrency = purchaseUnit.amount.currency_code || productCurrency;
          if (productPrice === '0.00') {
            productPrice = purchaseUnit.amount.value || productPrice;
          }
        }

        // Get customer info from PayPal
        const shipping = purchaseUnit?.shipping;
        if (shipping) {
          customerName = shipping.name?.full_name || customerName;
          customerAddress = shipping.address;
        } else if (captureData.payer) {
          customerName = `${captureData.payer.name?.given_name} ${captureData.payer.name?.surname}`.trim() || customerName;
        }
      } catch (e) {
        console.error('Failed to parse purchase data:', e);
      }

      // Get available keys from KV
      const availableKeys = await env.LICENSE_KEYS.get(productSlug, 'json') || [];

      // Download links mapping (with dynamic KV overrides)
      let ALL_DOWNLOAD_LINKS = {
        'office-2024-ltsc': 'https://officecdn.microsoft.com/pr/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/de-de/ProPlus2024Retail.img',
        'office-2024-pro-plus': 'https://officecdn.microsoft.com/pr/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/de-de/ProPlus2024Retail.img',
        'windows-11-pro': 'https://www.microsoft.com/software-download/windows11',
        'windows-10-pro': 'https://www.microsoft.com/software-download/windows10'
      };

      try {
        const dynamicLinks = await env.LICENSE_KEYS.get('DOWNLOAD_LINKS', 'json') || {};
        ALL_DOWNLOAD_LINKS = { ...ALL_DOWNLOAD_LINKS, ...dynamicLinks };
      } catch (e) {
        console.warn('Failed to fetch dynamic DOWNLOAD_LINKS', e);
      }

      const downloadLink = ALL_DOWNLOAD_LINKS[productSlug] || null;

      let assignedKey = null;
      let orderStatus = 'waiting_for_stock';

      if (availableKeys.length > 0) {
        // Key available - assign immediately
        assignedKey = availableKeys.shift();
        await env.LICENSE_KEYS.put(productSlug, JSON.stringify(availableKeys));
        orderStatus = 'completed';
      }

      // Save order to KV with proper order number
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
      const randomNum = Math.floor(1000 + Math.random() * 9000); // 4-digit random
      const orderNumber = `ORD-${dateStr}-${randomNum}`;

      // Improved Email Subjects for Admin Visibility
      const emailSubject = orderStatus === 'completed'
        ? `[NEUE BESTELLUNG] ${orderNumber} - ${productName} (Sofort-Versand)`
        : `[WARTE-LISTE] ${orderNumber} - ${productName}`;

      let emailHtml = '';
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await env.ORDERS.put(orderId, JSON.stringify({
        order_number: orderNumber,
        email: customerEmail,
        customer_name: customerName,
        product: productName,
        product_slug: productSlug,
        license_key: assignedKey,
        paypal_transaction_id: orderID,
        amount: productPrice,
        currency: productCurrency,
        timestamp: now.toISOString(),
        status: orderStatus,
        attributes: itemAttributes
      }));

      // --- INVOICE GENERATION (Refined Apple Style) ---
      let invoiceBase64 = null;
      try {
        const doc = new jsPDF();

        // Header
        doc.setFont("helvetica", "bold");
        doc.setFontSize(28);
        doc.setTextColor(29, 29, 31);
        doc.text("Softcrate", 15, 25);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0, 113, 227);
        doc.text(".", 57, 25);

        // Seller Info
        doc.setFontSize(9);
        doc.setTextColor(134, 134, 139);
        const sellerX = 140;
        doc.text("Softcrate Digital Solutions", sellerX, 20);
        doc.text("Lukas Schneider", sellerX, 25);
        doc.text("Liebermann Straße 2", sellerX, 30);
        doc.text("74078 Heilbronn", sellerX, 35);
        doc.text("support@softcrate.de", sellerX, 40);

        // Customer Info
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(29, 29, 31);
        doc.text("RECHNUNG AN", 15, 55);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(customerName, 15, 62);
        if (customerAddress) {
          doc.setFontSize(10);
          doc.setTextColor(100, 100, 100);
          doc.text(customerAddress.address_line_1 || "", 15, 68);
          doc.text(`${customerAddress.postal_code || ""} ${customerAddress.admin_area_2 || ""}`, 15, 73);
          doc.text(customerEmail, 15, 79);
        } else {
          doc.setFontSize(10);
          doc.setTextColor(100, 100, 100);
          doc.text(customerEmail, 15, 68);
        }

        // Invoice Meta Data
        doc.setFont("helvetica", "bold");
        doc.setTextColor(29, 29, 31);
        doc.text("BESTELLUNG", 140, 55);
        doc.text("DATUM", 140, 68);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(orderNumber, 140, 60);
        doc.text(now.toLocaleDateString('de-DE'), 140, 73);

        // Explicit Digital Delivery Note
        doc.setFillColor(250, 250, 252);
        doc.roundedRect(15, 90, 180, 15, 3, 3, 'F');
        doc.setFontSize(9);
        doc.setTextColor(0, 113, 227);
        doc.setFont(undefined, 'bold');
        doc.text("PRODUKT-HINWEIS:", 20, 99);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text("Digitaler Produktschlüssel (ESD). Kein physischer Versand von CD/DVD oder COA-Label.", 53, 99);

        // Table
        doc.autoTable({
          startY: 110,
          head: [['Produktbeschreibung', 'Menge', 'Preis']],
          body: [
            [`${productName}\n(Vollversion, Digitale Lizenz)`, "1", `${productPrice} ${productCurrency}`]
          ],
          theme: 'plain',
          headStyles: { fontSize: 10, fontStyle: 'bold', textColor: [29, 29, 31], cellPadding: 5 },
          bodyStyles: { fontSize: 10, textColor: [66, 66, 69], cellPadding: 5 },
          columnStyles: { 2: { halign: 'right' } },
          margin: { left: 15, right: 15 }
        });

        // Summary
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setDrawColor(230, 230, 235);
        doc.line(140, finalY, 195, finalY);

        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(29, 29, 31);
        doc.text("Gesamtbetrag:", 140, finalY + 10);
        doc.text(`${productPrice} ${productCurrency}`, 195, finalY + 10, { align: 'right' });

        // Legal Note (§ 19 UStG)
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(134, 134, 139);
        doc.text("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).", 15, finalY + 30);
        doc.text("Vielen Dank für Ihren Einkauf bei Softcrate!", 15, 280);

        invoiceBase64 = doc.output('datauristring').split(',')[1];
      } catch (pdfError) {
        console.error('PDF Generation failed:', pdfError);
      }

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
    <p class="intro-text">Ihre Zahlung wurde bestätigt. Hier ist Ihr Aktivierungsschlüssel. Eine Rechnung finden Sie im Anhang.</p>
    
    <div class="key-container">
      <div class="key-label">Produktschlüssel & Download</div>
      <div class="license-key">${assignedKey}</div>
      ${downloadLink ? `
      <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e5e5; display: block;">
        <a href="${downloadLink}" style="color: #0071e3; text-decoration: none; font-weight: 600; font-size: 15px;">📥 Installer (.exe) herunterladen</a>
      </div>
      ` : ''}
    </div>

    <div class="product-info">
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${productName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Betrag</span>
        <span class="info-value">${productPrice} ${productCurrency}</span>
      </div>
       <div class="info-row">
        <span class="info-label">Bestell-NR</span>
        <span class="info-value">${orderNumber}</span>
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
      <p style="margin: 0; font-size: 14px;">Ihre Rechnung finden Sie bereits im Anhang dieser E-Mail. Der Key folgt in Kürze automatisch.</p>
    </div>

    <p class="intro-text">
        Sobald Ihr Key bereit ist (in der Regel in weniger als 12 Stunden), senden wir ihn Ihnen <strong>automatisch per E-Mail</strong> zu.
        <br><br>
        Sie müssen nichts weiter tun.
    </p>


    <div class="product-info">
      <div class="info-row">
        <span class="info-label">Produkt</span>
        <span class="info-value">${productName || 'Ihre Software Bestellung'}</span>
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
            bcc: ['softcrate.team@gmail.com'],
            subject: emailSubject,
            html: emailHtml,
            attachments: invoiceBase64 ? [{ filename: `Rechnung_${orderNumber}.pdf`, content: invoiceBase64 }] : []
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

      // Send Discord notification
      const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1462871892640796755/eWuhK5afxDbkv85JCDBsYqBKItOscvUGOpgECdyc_JeR4Z_S7n3xxQJi4ApDTE8zRKu_';

      try {
        await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            embeds: [{
              title: '🚀 Neue Bestellung!',
              color: 3447003, // Blue
              fields: [
                { name: 'Bestell-Nr', value: orderNumber, inline: true },
                { name: 'Produkt', value: productName, inline: true },
                { name: 'Preis', value: `${productPrice} ${productCurrency}`, inline: true },
                { name: 'Kunde', value: customerEmail, inline: false },
                ...(itemAttributes?.canvaEmail ? [{ name: '📧 Canva Account', value: itemAttributes.canvaEmail, inline: false }] : []),
                { name: 'Status', value: orderStatus === 'completed' ? '✅ Key & Rechnung gesendet' : '⏳ Rechnung gesendet / Key Warteliste', inline: true }
              ],
              footer: { text: 'Softcrate Order System' },
              timestamp: new Date().toISOString()
            }]
          })
        });
        console.log('Discord notification sent');
      } catch (e) {
        console.error('Failed to send Discord notification:', e);
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
