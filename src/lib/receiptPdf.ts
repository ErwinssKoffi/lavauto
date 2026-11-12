import type { jsPDF as JsPdfDocument } from 'jspdf';
// Police servie depuis le même déploiement, sans appel à un CDN.
const fontUrl = `${import.meta.env.BASE_URL ?? '/'}fonts/DejaVuSans.ttf`;
import type { WashReceipt } from './receipt';
import { formatDateTime, formatFCFA } from './format';
import { receiptFilename } from './receipt';

function asBase64(bytes: Uint8Array): string {
  // Découpage pour éviter de dépasser la pile d'arguments sur la police TTF.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Génère un vrai PDF localement, avec pagination et police Unicode intégrée. */
export async function createReceiptPdf(receipt: WashReceipt, fontBytes: Uint8Array): Promise<JsPdfDocument> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', asBase64(fontBytes));
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.setFont('DejaVuSans', 'normal');
  doc.setProperties({ title: `Reçu ${receipt.number}`, subject: 'Récapitulatif de lavage et encaissements' });
  const left = 16, right = 194, maxY = 278;
  let y = 18;

  const page = (space: number) => {
    if (y + space <= maxY) return;
    const fontSize = doc.getFontSize();
    const textColor = doc.getTextColor();
    doc.addPage(); doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(9); doc.setTextColor(90, 99, 109);
    doc.text(`Reçu ${receipt.number} — suite`, left, 15);
    doc.setFontSize(fontSize); doc.setTextColor(textColor);
    y = 23;
  };
  const paragraph = (value: string, size = 10, color: [number, number, number] = [31, 41, 55]) => {
    doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(value || ' ', right - left) as string[];
    for (const line of lines) { page(5.5); doc.text(line, left, y); y += 5.5; }
  };
  const heading = (value: string) => {
    y += 3; page(12); doc.setDrawColor(213, 222, 230); doc.line(left, y, right, y); y += 6;
    paragraph(value, 11, [3, 105, 161]); y += 1;
  };
  const pair = (label: string, value: string) => {
    doc.setFontSize(10); doc.setTextColor(31, 41, 55);
    const lines = doc.splitTextToSize(label, 125) as string[];
    // Chaque ligne peut se répartir sur plusieurs pages sans chevauchement.
    for (let i = 0; i < lines.length; i++) {
      page(5.5); doc.text(lines[i], left, y);
      if (i === 0) doc.text(value, right, y, { align: 'right' });
      y += 5.5;
    }
  };

  paragraph(receipt.companyName || receipt.stationName, 16, [15, 23, 42]);
  if (receipt.companyName && receipt.stationName !== receipt.companyName) paragraph(receipt.stationName, 11);
  const contact = [receipt.stationAddress, receipt.stationCity, receipt.stationPhone].filter(Boolean).join(' · ');
  if (contact) paragraph(contact, 9, [90, 99, 109]);
  y += 3;
  paragraph(`REÇU DE LAVAGE · ${receipt.number}`, 14, [3, 105, 161]);
  paragraph(`Émis le ${formatDateTime(receipt.issuedAt)} (heure locale)`, 9, [90, 99, 109]);
  if (receipt.isCancelled) paragraph('FICHE ANNULÉE — ce document reflète une fiche annulée.', 11, [185, 28, 28]);
  heading('Informations de la fiche');
  paragraph(`Créée le ${formatDateTime(receipt.createdAt)} · Statut : ${receipt.status}`);
  paragraph(`Client : ${receipt.clientName || 'Non renseigné'}`);
  paragraph(`Véhicule : ${receipt.vehicleLabel || 'Non renseigné'}${receipt.plate ? ` · ${receipt.plate}` : ''}`);
  heading('Prestations et montants');
  if (receipt.items.length === 0) paragraph('Aucune prestation enregistrée.');
  for (const item of receipt.items) {
    pair(item.name, formatFCFA(item.amount));
    paragraph(`${item.quantity} × ${formatFCFA(item.unitPrice)} (prix figé)`, 9, [90, 99, 109]);
  }
  y += 2;
  pair('Sous-total', formatFCFA(receipt.subtotal));
  pair('Remise totale', `- ${formatFCFA(receipt.discount)}`);
  pair('Total enregistré', formatFCFA(receipt.total));
  pair('Encaissé net enregistré', formatFCFA(receipt.paid));
  pair(receipt.isCancelled ? 'Reste indicatif sur fiche annulée' : 'Reste à payer', formatFCFA(receipt.balance));
  heading('Encaissements');
  if (receipt.payments.length === 0) paragraph('Aucun encaissement enregistré.');
  for (const payment of receipt.payments) {
    pair(`${payment.method} · ${formatDateTime(payment.at)}${payment.cancelled ? ' · ANNULÉ / REMBOURSÉ' : ''}`, formatFCFA(payment.amount));
    if (payment.cancelledAt) paragraph(`Annulation enregistrée le ${formatDateTime(payment.cancelledAt)}`, 9, [90, 99, 109]);
  }
  if (receipt.inconsistencies.length) {
    heading('Vérification nécessaire');
    for (const warning of receipt.inconsistencies) paragraph(warning, 9, [185, 28, 28]);
  }
  y += 5;
  paragraph('Récapitulatif à la date d’émission ; les annulations ultérieures ne sont pas reflétées. Ce document n’est pas une facture fiscale.', 9, [90, 99, 109]);
  return doc;
}

export async function downloadReceiptPdf(receipt: WashReceipt): Promise<void> {
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error('Police du reçu indisponible ; réessayez ou utilisez l’impression.');
  const doc = await createReceiptPdf(receipt, new Uint8Array(await response.arrayBuffer()));
  doc.save(receiptFilename(receipt.number));
}
