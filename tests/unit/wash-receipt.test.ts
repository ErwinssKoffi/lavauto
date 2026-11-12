import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildWashReceipt, receiptFilename } from '../../src/lib/receipt';
import { createReceiptPdf } from '../../src/lib/receiptPdf';
import type { Company, PaymentCancellation, Station, Wash } from '../../src/types';

const company: Company = { id: 'co1', name: 'Éclat Auto', city: 'Abidjan', phone: '', createdAt: '2026-01-01', suspended: false };
const station: Station = {
  id: 'st1', companyId: 'co1', name: 'Cocody', address: 'Rue des Jardins', city: 'Abidjan', phone: '+2250700000000',
  currency: 'FCFA', logoPath: null, hours: [], paymentMethods: [], cashRequiresOpen: true,
  maxCashierDiscount: 0, commissionRate: 0, monthlyTarget: 0, activated: true, activatedAt: null,
};
const wash: Wash = {
  id: 'w1', stationId: 'st1', number: 'L-0001', clientId: 'c1', clientName: 'Adèle Yao',
  vehicleCategoryId: 'cat1', vehicleLabel: 'Berline', plate: '1234 AB 01', employeeId: 'u1',
  assignedUserIds: ['u1'], postId: null, createdAt: '2026-11-12T09:00:00.000Z',
  finishedAt: '2026-11-12T10:00:00.000Z', deliveredAt: null, cancelledReason: null, status: 'ready',
  qualityResult: 'approved', qualityNotes: null, history: [], discount: 1000, total: 9000, paid: 5000,
  items: [
    { serviceId: 's1', serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 2 },
    { serviceId: 's2', serviceName: 'Nettoyage intérieur', unitPrice: 4000, qty: 1 },
  ],
  payments: [
    { id: 'p1', amount: 3000, method: 'especes', at: '2026-11-12T09:05:00.000Z', byUserId: 'u1' },
    { id: 'p2', amount: 2000, method: 'wave', at: '2026-11-12T09:06:00.000Z', byUserId: 'u1' },
    { id: 'p3', amount: 1000, method: 'orange_money', at: '2026-11-12T09:07:00.000Z', byUserId: 'u1' },
  ],
};
const cancellations: PaymentCancellation[] = [{ id: 'r1', paymentId: 'p3', amount: 1000, reason: 'erreur', at: '2026-11-12T09:08:00.000Z' }];
const receipt = () => buildWashReceipt(wash, company, station, [], cancellations, '2026-11-12T11:00:00.000Z');

describe('Reçu de lavage', () => {
  it('conserve les prix figés, la remise globale et les paiements annulés sans les compter deux fois', () => {
    const r = receipt();
    expect(r.items.map((item) => item.amount)).toEqual([6000, 4000]);
    expect([r.subtotal, r.discount, r.total, r.paid, r.balance]).toEqual([10000, 1000, 9000, 5000, 4000]);
    expect(r.payments.map((p) => [p.method, p.cancelled])).toEqual([
      ['Espèces', false], ['Wave CI', false], ['Orange Money', true],
    ]);
    expect(r.payments[2].cancelledAt).toBe('2026-11-12T09:08:00.000Z');
    expect(r.inconsistencies).toEqual([]);
    expect(r.status).toBe('Prêt / terminé');
  });
  it('ne fait pas passer la station actuellement sélectionnée pour celle du lavage', () => {
    const r = buildWashReceipt({ ...wash, stationId: 'st2' }, company, station, [
      { id: 'st2', name: 'Yopougon', city: 'Yopougon', activated: true, logoPath: null },
    ], cancellations);
    expect(r.stationName).toBe('Yopougon'); expect(r.stationCity).toBe('Yopougon');
    expect(r.stationPhone).toBeNull(); expect(r.stationAddress).toBeNull();
    expect(buildWashReceipt({ ...wash, stationId: 'absente' }, company, station, [], cancellations).stationName).toBe('Station non renseignée');
  });
  it('signale une fiche annulée ou des données incohérentes plutôt que de fabriquer un solde', () => {
    const r = buildWashReceipt({ ...wash, status: 'cancelled', paid: 6000, total: 8000 }, company, station, [], cancellations);
    expect(r.isCancelled).toBe(true); expect(r.status).toBe('Annulé');
    expect(r.balance).toBe(2000); expect(r.inconsistencies).toHaveLength(2);
    const empty = buildWashReceipt({ ...wash, items: [], payments: [], discount: 0, total: 0, paid: 0 }, null, null);
    expect(empty.items).toEqual([]); expect(empty.payments).toEqual([]); expect(empty.inconsistencies).toEqual([]);
  });
  it('produit un nom de fichier sûr', () => {
    expect(receiptFilename('../Fiche été / 42')).toBe('recu-Fiche-e-te-42.pdf');
    expect(receiptFilename('///')).toBe('recu-lavage.pdf');
  });
  it('crée un PDF lisible avec accents, paiements annulés et montants réels', async () => {
    const font = new Uint8Array(readFileSync('public/fonts/DejaVuSans.ttf'));
    const doc = await createReceiptPdf(receipt(), font);
    const buffer = new Uint8Array(doc.output('arraybuffer'));
    expect(new TextDecoder().decode(buffer.subarray(0, 8))).toContain('%PDF-');
    const pdf = await getDocument({ data: buffer, useSystemFonts: false }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((entry) => 'str' in entry ? entry.str : '').join(' ');
    expect(text).toContain('Éclat Auto');
    expect(text).toContain('Adèle Yao');
    expect(text).toContain('Lavage extérieur');
    expect(text).toContain('9 000 FCFA');
    expect(text).toContain('5 000 FCFA');
    expect(text).toContain('4 000 FCFA');
    expect(text).toContain('ANNULÉ / REMBOURSÉ');
    expect(text).toContain('facture fiscale');
    await pdf.cleanup();
  }, 20_000);
  it('pagine un long reçu sans perdre les dernières prestations', async () => {
    const longWash = { ...wash, items: Array.from({ length: 100 }, (_, i) => ({
      serviceId: `s${i}`, serviceName: `Prestation longue numéro ${i + 1}`, unitPrice: 1, qty: 1,
    })), discount: 0, total: 100, paid: 0, payments: [] };
    const doc = await createReceiptPdf(buildWashReceipt(longWash, company, station), new Uint8Array(readFileSync('public/fonts/DejaVuSans.ttf')));
    const pdf = await getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
    expect(pdf.numPages).toBeGreaterThan(1);
    const texts = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1); const content = await page.getTextContent();
      return content.items.map((entry) => 'str' in entry ? entry.str : '').join(' ');
    }));
    expect(texts.join(' ')).toContain('Prestation longue numéro 100');
    expect(texts[texts.length - 1]).toContain('100 FCFA');
    await pdf.cleanup();
  }, 20_000);
});
