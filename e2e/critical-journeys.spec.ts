import { expect, test, type Locator, type Page } from '@playwright/test';
import { journeyState, savedState, seedJourney } from './fixtures/journey';

async function expectMetric(root: Locator | Page, label: string, value: string): Promise<void> {
  await expect(root.getByText(label, { exact: true }).locator('..')).toContainText(value);
}

// Ces parcours exercent le navigateur et les adaptateurs LOCAUX. Aucun compte,
// e-mail ou mouvement n'est créé sur un service distant.
test('18 — caisse, lavage, paiements mixtes et clôture persistent après rechargement', async ({ page }) => {
  test.setTimeout(90_000);
  await seedJourney(page);
  await page.goto('/app/caisse');
  await expect(page.getByText('Aucune caisse ouverte')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir la caisse', exact: true }).first().click();
  const opening = page.getByRole('dialog', { name: 'Ouvrir la caisse' });
  await opening.getByLabel('Fond de caisse (FCFA) *').fill('10000');
  await opening.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(opening).toHaveCount(0);
  await expectMetric(page, 'Fond de caisse', '10 000 FCFA');
  await expectMetric(page, 'Théorique en caisse', '10 000 FCFA');

  // page.goto et reload provoquent de vrais changements de document : la
  // fixture initiale ne doit pas écraser la caisse qui vient d'être créée.
  await page.goto('/app/lavages');
  await page.getByRole('button', { name: 'Nouvelle fiche' }).click();
  const create = page.getByRole('dialog', { name: 'Nouvelle fiche de lavage' });
  await create.getByLabel('Plaque (facultative)').fill('4567 CD 01');
  await create.getByLabel('Nom du client sans fiche (facultatif)').fill('Awa Test');
  await create.getByRole('checkbox', { name: 'Sélectionner Lavage complet' }).check();
  await create.getByLabel('Remise (FCFA)').fill('500');
  await expectMetric(create, 'Total estimé de la fiche', '5 500 FCFA');
  await create.getByLabel('Montant encaissé (FCFA)').fill('1000');
  await create.getByLabel('Moyen de paiement').selectOption('especes');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: '4567 CD 01' });
  await expect(row).toContainText('5 500 FCFA');
  await expect(row).toContainText('1 000 FCFA');
  await expect(row).toContainText('4 500 FCFA');
  await expect(row).toContainText('Affecté');
  // La première entrée espèces doit elle aussi être liée au paiement et à la caisse.
  await expect.poll(async () => {
    const saved = await savedState(page);
    const payment = saved.washes[0]?.payments[0];
    const movement = saved.cashMovements[0];
    return {
      payments: saved.washes[0]?.payments.length,
      movements: saved.cashMovements.length,
      amount: movement?.amount,
      paymentMatches: Boolean(payment && movement?.paymentId === payment.id),
      sessionMatches: movement?.cashSessionId === saved.cashSessions[0]?.id,
    };
  }).toEqual({ payments: 1, movements: 1, amount: 1000, paymentMatches: true, sessionMatches: true });

  await row.getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-0001' });
  await expectMetric(detail, 'Reste à payer', '4 500 FCFA');
  await detail.getByLabel('Montant à encaisser (FCFA)').fill('2000');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expectMetric(detail, 'Encaissé', '3 000 FCFA');
  await expectMetric(detail, 'Reste à payer', '2 500 FCFA');
  await detail.getByLabel('Montant à encaisser (FCFA)').fill('2500');
  await detail.getByLabel('Moyen de paiement').selectOption('mobile_money');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expectMetric(detail, 'Encaissé', '5 500 FCFA');
  await expectMetric(detail, 'Reste à payer', '0 FCFA');
  await expect(detail.getByRole('button', { name: 'Encaisser', exact: true })).toHaveCount(0);
  await expect(detail.getByText('En cours', { exact: true }).first()).toBeVisible();

  await detail.getByRole('button', { name: 'Envoyer au contrôle qualité' }).click();
  await detail.getByRole('button', { name: 'Valider → Prêt' }).click();
  await expect(detail.getByText('Prêt / terminé', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/^Livré le/)).toHaveCount(0);
  await detail.getByRole('button', { name: 'Livrer au client' }).click();
  await expect(detail.getByText(/^Livré le/)).toBeVisible();

  // Modifier la grille après coup ne doit pas recalculer la fiche vendue.
  await page.goto('/app/prestations');
  const service = page.getByRole('row').filter({ hasText: 'Lavage complet' });
  await service.locator('input[type="number"]').first().fill('7000');
  await expect.poll(async () => (await savedState(page)).services.find((s) => s.id === 's2')?.prices.c1).toBe(7000);
  await page.goto('/app/lavages');
  await expect(page.getByRole('row').filter({ hasText: '4567 CD 01' })).toContainText('5 500 FCFA');
  await expect(page.getByRole('row').filter({ hasText: '4567 CD 01' })).toContainText('Livré');

  await page.goto('/app/caisse');
  // 10 000 + 1 000 + 2 000 : les 2 500 Mobile Money restent hors caisse.
  await expectMetric(page, 'Théorique en caisse', '13 000 FCFA');
  await expectMetric(page, 'Mouvements', '2');
  await page.getByRole('button', { name: 'Clôturer avec comptage' }).click();
  const closing = page.getByRole('dialog', { name: 'Clôturer la caisse avec comptage' });
  await expectMetric(closing, 'Théorique attendu', '13 000 FCFA');
  await closing.getByLabel('Montant physique compté (FCFA) *').fill('12750');
  await expectMetric(closing, 'Écart au comptage', '-250 FCFA');
  await expect(closing.getByText('Déficit de caisse constaté')).toBeVisible();
  await closing.getByRole('button', { name: 'Sceller et clôturer' }).click();
  await expect(closing).toHaveCount(0);
  await expect(page.getByText('Aucune caisse ouverte')).toBeVisible();
  const closures = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Écart conservé' }) });
  await expect(closures.getByRole('row').nth(1)).toContainText('13 000 FCFA');
  await expect(closures.getByRole('row').nth(1)).toContainText('12 750 FCFA');
  await expect(closures.getByRole('row').nth(1)).toContainText('-250 FCFA');

  await page.reload();
  await expect(page.getByText('Aucune caisse ouverte')).toBeVisible();
  await expect(closures.getByRole('row').nth(1)).toContainText('12 750 FCFA');
  await expect.poll(async () => {
    const saved = await savedState(page);
    const wash = saved.washes[0];
    const session = saved.cashSessions[0];
    const closure = saved.cashClosures[0];
    const payments = saved.cashMovements.filter((m) => m.kind === 'payment_in');
    return {
      status: session?.status,
      total: wash?.total,
      unitPrice: wash?.items[0]?.unitPrice,
      paid: wash?.paid,
      washStatus: wash?.status,
      delivered: Boolean(wash?.deliveredAt),
      paymentAmounts: wash?.payments.map((p) => [p.method, p.amount]),
      cashAmounts: payments.map((m) => m.amount),
      cashPaymentsLinked: payments.every((m) => m.cashSessionId === session?.id
        && wash?.payments.some((p) => p.id === m.paymentId && p.method === 'especes')),
      closure: closure && [closure.cashSessionId === session?.id, closure.theoretical, closure.counted, closure.difference],
      closingAmounts: saved.cashMovements.filter((m) => m.kind === 'closing').map((m) => m.amount),
    };
  }).toEqual({
    status: 'cloturee', total: 5500, unitPrice: 6000, paid: 5500, washStatus: 'delivered', delivered: true,
    paymentAmounts: [['especes', 1000], ['especes', 2000], ['mobile_money', 2500]],
    cashAmounts: [1000, 2000], cashPaymentsLinked: true,
    closure: [true, 13000, 12750, -250], closingAmounts: [-250],
  });
});

test('19 — validations lavage et caisse fermée : aucune écriture erronée', async ({ page }) => {
  test.setTimeout(60_000);
  await seedJourney(page);
  await page.goto('/app/lavages');
  await page.getByRole('button', { name: 'Nouvelle fiche' }).click();
  const create = page.getByRole('dialog', { name: 'Nouvelle fiche de lavage' });
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create.getByText('Sélectionnez au moins une prestation.')).toBeVisible();
  await expect.poll(async () => (await savedState(page)).washes.length).toBe(0);

  await create.getByRole('checkbox', { name: 'Sélectionner Lavage extérieur' }).check();
  await create.getByLabel('Plaque (facultative)').fill('8888 ZZ 01');
  await create.getByLabel('Montant encaissé (FCFA)').fill('3001');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create.getByText('L’encaissement dépasse le total de la fiche.')).toBeVisible();
  await expect.poll(async () => (await savedState(page)).washes.length).toBe(0);

  await create.getByLabel('Montant encaissé (FCFA)').fill('1000');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  const cashClosed = page.getByText('Un encaissement en espèces exige une caisse ouverte (règle désactivable dans Paramètres).', { exact: true });
  await expect(cashClosed).toBeVisible();
  await cashClosed.locator('..').getByRole('button', { name: 'Fermer' }).click();
  await expect(create).toBeVisible();
  await expect.poll(async () => (await savedState(page)).washes.length).toBe(0);

  await create.getByLabel('Moyen de paiement').selectOption('mobile_money');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: '8888 ZZ 01' });
  await expect(row).toContainText('2 000 FCFA');
  await row.getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-0001' });
  await detail.getByLabel('Montant à encaisser (FCFA)').fill('2001');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expect(page.getByText('Le montant dépasse le reste à payer.', { exact: true })).toBeVisible();
  await expectMetric(detail, 'Reste à payer', '2 000 FCFA');

  await detail.getByLabel('Montant à encaisser (FCFA)').fill('2000');
  await detail.getByLabel('Moyen de paiement').selectOption('especes');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expect(cashClosed).toBeVisible();
  await expectMetric(detail, 'Reste à payer', '2 000 FCFA');
  await expect.poll(async () => (await savedState(page)).washes[0].payments.length).toBe(1);
  await detail.getByLabel('Moyen de paiement').selectOption('mobile_money');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expectMetric(detail, 'Reste à payer', '0 FCFA');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: '8888 ZZ 01' })).toContainText('En cours');
  await expect.poll(async () => {
    const saved = await savedState(page);
    return {
      washes: saved.washes.length, paid: saved.washes[0]?.paid,
      payments: saved.washes[0]?.payments.map((p) => [p.method, p.amount]),
      cashSessions: saved.cashSessions.length, movements: saved.cashMovements.length,
    };
  }).toEqual({ washes: 1, paid: 3000, payments: [['mobile_money', 1000], ['mobile_money', 2000]], cashSessions: 0, movements: 0 });
});

test('20 — invitation locale : validations, rôle, station, doublon et révocation', async ({ page }) => {
  test.setTimeout(60_000);
  await seedJourney(page);
  await page.goto('/app/employes');
  await expect(page.getByText(/Mode démonstration locale : aucun e-mail n’est envoyé/)).toBeVisible();
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByText('Remplissez le nom et l’adresse e-mail.')).toBeVisible();
  await invite.getByLabel('Nom complet *').fill('Aminata Test');
  await invite.getByLabel('Adresse e-mail *').fill('AMINATA@EXAMPLE.INVALID');
  await invite.getByLabel('Téléphone').fill('0701020304');
  await invite.getByLabel('Rôle').selectOption('laveur');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption([]);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByText('Affectez au moins une station.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedState(page)).users.length).toBe(2);

  await invite.getByLabel('Stations * (sélection multiple)').selectOption('st1');
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0);
  const employees = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Commission' }) });
  const invitations = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Expire le' }) });
  const employee = employees.getByRole('row').filter({ hasText: 'aminata@example.invalid' });
  const invitation = invitations.getByRole('row').filter({ hasText: 'aminata@example.invalid' });
  await expect(employee).toContainText('Aminata Test');
  await expect(employee).toContainText('Laveur');
  await expect(employee).toContainText('Clean Auto Cocody');
  await expect(invitation).toContainText('Laveur');
  await expect(invitation).toContainText('Clean Auto Cocody');
  await expect(invitation).toContainText('En attente');
  await expect.poll(async () => (await savedState(page)).users.filter((u) => u.email === 'aminata@example.invalid').map((u) => [u.name, u.role, u.stationId])).toEqual([
    ['Aminata Test', 'laveur', 'st1'],
  ]);

  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  await invite.getByLabel('Nom complet *').fill('Autre nom');
  await invite.getByLabel('Adresse e-mail *').fill('AMINATA@EXAMPLE.INVALID');
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByText('Cette adresse e-mail est déjà utilisée.')).toBeVisible();
  await expect(invitation).toContainText('En attente');
  await expect.poll(async () => (await savedState(page)).users.filter((u) => u.email === 'aminata@example.invalid').length).toBe(1);
  await invite.getByRole('button', { name: 'Annuler' }).click();
  await invitation.getByTitle('Révoquer').click();
  await expect(invitation).toContainText('Révoquée');
  await expect(invitation.getByTitle('Révoquer')).toHaveCount(0);
});

test('21 — un caissier ne voit pas le formulaire d’invitation', async ({ page }) => {
  await seedJourney(page, journeyState({
    userId: 'u2', email: 'moussa@cleanauto.ci', name: 'Moussa Laveur', role: 'caissier', companyId: 'co1', stationId: 'st1',
  }));
  await page.goto('/app/employes');
  await expect(page.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
  await expect(page.getByText(/employees\.manage/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toHaveCount(0);
  await expect.poll(async () => (await savedState(page)).users.length).toBe(2);
});
