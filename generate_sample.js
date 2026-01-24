const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const fs = require('fs');
const path = require('path');

function generateSampleInvoice() {
    const doc = new jsPDF();
    const now = new Date();
    const orderNumber = "ORD-20260124-1234";
    const customerName = "Max Mustermann";
    const customerEmail = "max@example.com";
    const productName = "Windows 11 Professional";
    const productPrice = "14,90";
    const productCurrency = "EUR";

    // Header - Modern Minimalism
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(29, 29, 31); // Apple Dark Gray
    doc.text("Softcrate", 15, 25);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 113, 227); // Apple Blue
    doc.text(".", 57, 25);

    // Seller Info (Right side) - Clean & Lite
    doc.setFontSize(9);
    doc.setTextColor(134, 134, 139); // Apple Secondary Text
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
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Musterstraße 123", 15, 68);
    doc.text("12345 Musterstadt", 15, 73);
    doc.text(customerEmail, 15, 79);

    // Invoice Meta Data
    doc.setFont("helvetica", "bold");
    doc.setTextColor(29, 29, 31);
    doc.text("BESTELLUNG", 140, 55);
    doc.text("DATUM", 140, 68);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(orderNumber, 140, 60);
    doc.text(now.toLocaleDateString('de-DE'), 140, 73);

    // Explicit Digital Delivery Note (Crucial)
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
        headStyles: {
            fontSize: 10,
            fontStyle: 'bold',
            textColor: [29, 29, 31],
            cellPadding: 5
        },
        bodyStyles: {
            fontSize: 10,
            textColor: [66, 66, 69],
            cellPadding: 5
        },
        columnStyles: {
            2: { halign: 'right' }
        },
        margin: { left: 15, right: 15 }
    });

    // Summary Line
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
    doc.text("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.", 15, finalY + 30);
    doc.text("Die Lizenz ist zur dauerhaften Aktivierung auf einem Gerät vorgesehen.", 15, finalY + 35);

    // Footer lines
    doc.setFontSize(8);
    doc.setTextColor(170, 170, 175);
    doc.text("Softcrate Digital Excellence | www.softcrate.de", 105, 285, { align: "center" });

    const pdfOutput = doc.output();
    fs.writeFileSync('sample_invoice.pdf', pdfOutput, 'binary');
    console.log('Sample invoice generated: sample_invoice.pdf');
}

generateSampleInvoice();
