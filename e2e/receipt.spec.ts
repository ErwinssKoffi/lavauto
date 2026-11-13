import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { baseState } from './fixtures/state';
import { seedJourney } from './fixtures/journey';

test('reçu local : aperçu exact, impression isolée et vrai PDF téléchargeable', async ({ page }) => {
  const fixture = baseState();
  const washes = fixture.washes as Array<Record<string, unknown>>;
  const wash = washes[0];
  wash.items = [
    { serviceId: 's1', serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 2 },
    { serviceId: 's2', serviceName: 'Intérieur', unitPrice: 4000, qty: 1 },
  ];
  wash.discount = 1000; wash.total = 9000; wash.paid = 5000;
  wash.payments = [
    { id: 'p1', amount: 3000, method: 'especes', at: '2026-11-12T09:00:00Z', byUserId: 'u1' },
    { id: 'p2', amount: 2000, method: 'wave', at: '2026-11-12T09:01:00Z', byUserId: 'u1' },
    { id: 'p3', amount: 1000, method: 'orange_money', at: '2026-11-12T09:02:00Z', byUserId: 'u1', cancelledAt: '2026-11-12T09:03:00Z' },
  ];
  await seedJourney(page, fixture);
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => { (window as unknown as { printed: number }).printed += 1; };
  });
  await page.goto('/app/lavages');
  await page.getByRole('row').filter({ hasText: 'L-0001' }).getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-0001' });
  await expect(detail.getByText('Mode local ou session connectée indisponible : aucun message réel n’est envoyé.')).toBeVisible();
  await detail.getByRole('button', { name: 'Reçu client' }).click();
  const preview = page.getByRole('dialog', { name: 'Reçu L-0001' });
  await expect(preview).toBeVisible();
  const receipt = preview.getByRole('article', { name: 'Reçu L-0001' });
  await expect(receipt).toContainText('Lavage extérieur');
  await expect(receipt).toContainText('10 000 FCFA');
  await expect(receipt).toContainText('9 000 FCFA');
  await expect(receipt).toContainText('5 000 FCFA');
  await expect(receipt).toContainText('4 000 FCFA');
  await expect(receipt).toContainText('Annulé / remboursé');
  await expect(receipt).toContainText('n’est pas une facture fiscale');
  await expect(receipt).not.toContainText('Vérification nécessaire');

  await preview.getByRole('button', { name: 'Imprimer' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  expect(await page.evaluate(() => ({
    app: getComputedStyle(document.querySelector('#root')!).display,
    receipt: getComputedStyle(document.querySelector('.wash-receipt-print-root')!).display,
  }))).toEqual({ app: 'none', receipt: 'block' });
  await page.emulateMedia({ media: 'screen' });

  const downloadPromise = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Télécharger le PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('recu-L-0001.pdf');
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1000);
  await preview.getByRole('button', { name: 'Fermer' }).click();
  await expect(preview).toHaveCount(0);
  await detail.getByRole('button', { name: 'Fermer' }).first().click();
  await expect(detail).toHaveCount(0);
});
