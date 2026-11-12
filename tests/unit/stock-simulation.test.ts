// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import type { AppState } from '../../src/types';
import type { StockSnapshot } from '../../src/lib/stock';
import type { StockCommands } from '../../src/services/adapters/DataAdapter';
import type { AuthIdentity } from '../../src/services/auth/authTypes';
import { LocalDataAdapter } from '../../src/services/adapters/LocalDataAdapter';
import { SupabaseStockCommands } from '../../src/services/adapters/SupabaseStockCommands';
import type { SupabaseReader } from '../../src/services/adapters/SupabaseDataAdapter';

const fake = vi.hoisted(() => ({
  source: 'local' as 'local' | 'supabase',
  authKind: 'local' as 'local' | 'supabase',
  identity: null as AuthIdentity | null,
  commands: null as StockCommands | null,
  board: null as StockSnapshot | null,
  readBoard: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../src/services/adapters/DataAdapter', () => ({
  getDataSource: () => fake.source,
  getDataAdapter: (getState: () => AppState) => {
    const adapter = new LocalDataAdapter(getState);
    if (fake.commands) Object.defineProperty(adapter, 'stockCommands', { value: fake.commands });
    if (fake.board) Object.defineProperty(adapter, 'listStockBoard', { value: fake.readBoard });
    return adapter;
  },
}));

vi.mock('../../src/services/auth/getAuthPort', () => ({
  getAuthPort: () => ({
    kind: fake.authKind,
    onAuthStateChange: (handler: (change: unknown) => void) => {
      let active = true;
      if (fake.identity) {
        queueMicrotask(() => { if (active) handler({ type: 'INITIAL_SESSION', identity: fake.identity }); });
      }
      return { unsubscribe: () => { active = false; } };
    },
    listUsers: async () => ({ identity: fake.identity, users: [] }),
    listInvitations: async () => [],
  }),
}));

import { emptyState, StoreProvider, useStore } from '../../src/lib/store';
import { stockBoardFromState, withStockDefaults } from '../../src/lib/stock';
import Settings from '../../src/pages/Settings';
import StockAlertBanner from '../../src/components/StockAlertBanner';

const product = {
  id: 'product-1', stationId: 'st1', categoryId: null, sku: 'SH-1', name: 'Shampoing',
  category: 'Consommables', unit: 'L', reorderLevel: 3, averageCostMinor: 100, active: true,
};
const level = {
  productId: product.id, stationId: 'st1', name: product.name, unit: product.unit,
  reorderLevel: 3, qtyOnHand: 2, averageCostMinor: 100, valueMinor: 200,
};
const identity: AuthIdentity = {
  userId: 'u1', email: 'erwin@cleanauto.ci', fullName: 'Erwin Koffi', role: 'proprietaire',
  roleKey: 'owner', permissions: ['settings.manage', 'inventory.view'], companyId: 'co1',
  stationIds: ['st1'], stations: [{ id: 'st1', name: 'Clean Auto Cocody', city: 'Abidjan', activated: true, logoPath: null }],
  company: { id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '', currencyCode: 'XOF', suspended: false, createdAt: '2026-01-01T00:00:00Z' },
  isPlatformAdmin: false, active: true, emailConfirmed: true, profileReady: true,
};

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof useStore>;

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

function fixture(demoMode = false): Record<string, unknown> {
  return { ...baseState(), demoMode, products: [product], stockLevels: [level], stockMovements: [] };
}
function board(withProduct: boolean): StockSnapshot {
  const state = {
    ...emptyState(), ...baseState(), products: withProduct ? [product] : [],
    stockLevels: withProduct ? [level] : [], stockMovements: [],
  } as AppState;
  return stockBoardFromState(withStockDefaults(state));
}
function Probe() {
  store = useStore();
  return null;
}
async function mount(state: Record<string, unknown> = fixture()) {
  localStorage.setItem('washguard.state.v1', JSON.stringify(state));
  const content = React.createElement(MemoryRouter,
    { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Probe),
    React.createElement('div', { id: 'test-settings' }, React.createElement(Settings)),
    React.createElement('div', { id: 'test-banner' }, React.createElement(StockAlertBanner)),
  );
  await act(async () => { root.render(React.createElement(StoreProvider, { children: content })); });
}
function byLabel(scope: Element, label: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Bouton introuvable : ${label}`);
  return button;
}
function byText(scope: Element, text: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Bouton introuvable : ${text}`);
  return button;
}
function section(selector: string): Element {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`Section introuvable : ${selector}`);
  return found;
}
async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); });
}
function serverCommands() {
  fake.rpc.mockResolvedValue({ data: 'server-id', error: null });
  return new SupabaseStockCommands({ rpc: fake.rpc } as unknown as SupabaseReader);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  fake.source = 'local';
  fake.authKind = 'local';
  fake.identity = null;
  fake.commands = null;
  fake.board = null;
  fake.readBoard.mockReset();
  fake.rpc.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
});

describe('commandes de stock réservées à la démonstration locale', () => {
  it('affiche des simulations explicites et met à jour les alertes uniquement dans le navigateur', async () => {
    await mount(fixture(false)); // demoMode ne sert pas de garde : une Auth locale peut le laisser à false.
    expect(store.isLocalStockDemo).toBe(true);
    expect(store.state.demoMode).toBe(false);
    const settings = section('#test-settings #stock');
    expect(settings.textContent).toContain('Démonstration locale');
    expect(settings.textContent).toContain('Aucun mouvement n’est envoyé au serveur');
    expect(settings.textContent).toContain('Simulation locale');

    await click(byLabel(settings, 'Simuler une consommation de 1 L pour Shampoing'));
    expect(store.state.stockLevels[0].qtyOnHand).toBe(1);
    expect(store.state.stockAlerts[0].qtyOnHand).toBe(1);
    expect(store.state.stockMovements[0]).toMatchObject({ referenceType: 'quick_adjustment', qtyDelta: -1 });
    expect(store.toasts[store.toasts.length - 1]?.message).toContain('Simulation locale');

    await click(byText(section('#test-banner'), 'Voir les niveaux'));
    const banner = section('#test-banner');
    expect(banner.textContent).toContain('simulation locale');
    await click(byLabel(banner, 'Simuler un réapprovisionnement de 5 L pour Shampoing'));
    expect(store.state.stockLevels[0].qtyOnHand).toBe(6);
    expect(store.state.stockMovements[0]).toMatchObject({ referenceType: 'quick_adjustment', qtyDelta: 5 });
    expect(store.state.stockAlerts).toHaveLength(0);

    await click(byLabel(settings, 'Simuler un réapprovisionnement de 5 L pour Shampoing'));
    expect(store.state.stockLevels[0].qtyOnHand).toBe(11);
    const input = settings.querySelector<HTMLInputElement>('#stock-threshold-product-1');
    expect(input).not.toBeNull();
    await act(async () => {
      input!.focus();
      input!.value = '12';
      input!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(store.state.products[0].reorderLevel).toBe(12);
    expect(store.state.stockLevels[0].reorderLevel).toBe(12);
    expect(store.state.stockAlerts[0]).toMatchObject({ qtyOnHand: 11, reorderLevel: 12 });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['supabase', 'supabase'],
    ['supabase', 'local'],
    ['local', 'supabase'],
  ] as const)('masque les commandes et refuse les appels directs pour source %s et Auth %s', async (source, authKind) => {
    fake.source = source;
    fake.authKind = authKind;
    fake.commands = serverCommands();
    if (source === 'supabase' && authKind === 'supabase') {
      fake.identity = identity;
      fake.board = board(true);
      fake.readBoard.mockResolvedValue(fake.board);
    }
    await mount(fixture(true)); // Un ancien cache démo ne doit pas ouvrir les commandes.
    expect(store.isLocalStockDemo).toBe(false);
    // La source connectée ne restaure plus les données métier du cache local.
    expect(store.state.demoMode).toBe(source === 'local');
    const settings = section('#test-settings #stock');
    expect(store.isServerStock).toBe(source === 'supabase' && authKind === 'supabase');
    if (source !== authKind) expect(settings.textContent).toContain('les opérations sont bloquées');
    expect(settings.querySelector('#stock-threshold-product-1')).toBeNull();
    expect(settings.querySelectorAll('button[aria-label^="Simuler"]')).toHaveLength(0);
    if (source === 'supabase' && authKind === 'local') {
      expect(store.state.products).toEqual([]);
      expect(settings.textContent).toContain('Aucun produit configuré');
    } else {
      expect(settings.textContent).toContain('Shampoing');
      expect(settings.textContent).toContain('Seuils en lecture seule');
      await click(byText(section('#test-banner'), 'Voir les niveaux'));
      const banner = section('#test-banner');
      expect(banner.textContent).toContain('Voir le seuil');
      expect(banner.querySelectorAll('button[aria-label^="Simuler"]')).toHaveLength(0);
      expect(banner.querySelector('a[href="/app/stock"]')).not.toBeNull();
    }

    const before = JSON.stringify({ products: store.state.products, levels: store.state.stockLevels,
      alerts: store.state.stockAlerts, movements: store.state.stockMovements, toasts: store.toasts });
    await act(async () => {
      expect(() => store.adjustProductStock(product.id, 7)).toThrow(/mode démo local/);
      expect(() => store.updateStockThreshold(product.id, 12)).toThrow(/mode démo local/);
    });
    expect(JSON.stringify({ products: store.state.products, levels: store.state.stockLevels,
      alerts: store.state.stockAlerts, movements: store.state.stockMovements, toasts: store.toasts })).toBe(before);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['supabase', 'local'],
    ['local', 'supabase'],
  ] as const)('ne crée pas de produits d’exemple en configuration mixte %s / %s', async (source, authKind) => {
    fake.source = source;
    fake.authKind = authKind;
    await mount({ ...baseState(), demoMode: true, products: [], stockLevels: [], stockMovements: [] });
    expect(store.isLocalStockDemo).toBe(false);
    expect(store.state.products).toEqual([]);
    expect(store.state.stockAlerts).toEqual([]);
    expect(section('#test-settings #stock').textContent).toContain('Aucun produit configuré');
  });

  it('refuse aussi les mutations locales lorsque l’adaptateur stock serveur est indisponible', async () => {
    fake.source = 'supabase';
    fake.authKind = 'supabase';
    fake.commands = null;
    await mount(fixture(true));
    expect(store.isLocalStockDemo).toBe(false);
    expect(store.isServerStock).toBe(false);
    expect(section('#test-settings #stock').textContent).toContain('les opérations sont bloquées');
    await act(async () => {
      expect(() => store.adjustProductStock(product.id, 7)).toThrow(/mode démo local/);
      expect(() => store.updateStockThreshold(product.id, 12)).toThrow(/mode démo local/);
    });
    expect(store.state.stockLevels).toEqual([]);
    expect(store.state.products).toEqual([]);
    expect(store.state.stockMovements).toEqual([]);
    expect(store.toasts).toEqual([]);
  });

  it.each([
    ['supabase', 'local', true],
    ['local', 'supabase', true],
    ['supabase', 'supabase', false],
  ] as const)('refuse toutes les écritures stock sans mode local ou port RPC (%s / %s / %s)', async (source, authKind, hasCommands) => {
    fake.source = source;
    fake.authKind = authKind;
    fake.commands = hasCommands ? serverCommands() : null;
    await mount(fixture(true));
    const before = JSON.stringify({ state: store.state, toasts: store.toasts });
    const writes: Array<() => unknown> = [
      () => store.saveSupplier({ stationId: 'st1', name: 'Fournisseur' }),
      () => store.saveProduct({ stationId: 'st1', name: 'Produit' }),
      () => store.createPurchaseOrder({ stationId: 'st1', number: 'CMD-1', orderedAt: '2026-01-01', lines: [], idempotencyKey: 'order-1' }),
      () => store.receivePurchaseLines({ orderId: 'order-1', receiptKey: 'receipt-1', lines: [] }),
      () => store.startInventory('st1'),
      () => store.recordInventoryCount({ sessionId: 'inventory-1', productId: product.id, countedQty: 4 }),
      () => store.closeInventory('inventory-1'),
      () => store.saveServiceConsumption({ serviceId: 's1', productId: product.id, qtyPerWash: 1 }),
      () => store.consumeWash('wash-1'),
      () => store.linkExpenseToOrder('expense-1', 'order-1'),
      () => store.certifyCosts({ start: '2026-01-01', end: '2026-01-31', attestation: 'Je certifie les coûts.' }),
    ];
    await act(async () => {
      for (const write of writes) expect(write).toThrow(/Stock serveur indisponible|station n’est pas encore activée/);
    });
    expect(JSON.stringify({ state: store.state, toasts: store.toasts })).toBe(before);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('conserve les parcours locaux de produit, commande et réception en démonstration', async () => {
    await mount();
    let productId = '';
    let orderId = '';
    await act(async () => {
      productId = await store.saveProduct({ stationId: 'st1', name: 'Produit démo', unit: 'L', reorderLevel: 1 });
    });
    await act(async () => {
      orderId = await store.createPurchaseOrder({ stationId: 'st1', number: 'CMD-DEMO', orderedAt: '2026-01-01',
        lines: [{ productId, qtyOrdered: 5, unitCostMinor: 100 }], idempotencyKey: 'order-demo' });
    });
    await act(async () => {
      await store.receivePurchaseLines({ orderId, receiptKey: 'receipt-demo', lines: [{ productId, qty: 5, unitCostMinor: 100 }] });
    });
    expect(store.state.stockLevels.find((item) => item.productId === productId)?.qtyOnHand).toBe(5);
    expect(store.state.stockMovements.some((item) => item.productId === productId && item.kind === 'purchase_receipt')).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('ne transforme pas un tableau de bord serveur vide en produits ou alertes fictifs', async () => {
    fake.source = 'supabase';
    fake.authKind = 'supabase';
    fake.identity = identity;
    fake.commands = serverCommands();
    fake.board = board(false);
    fake.readBoard.mockResolvedValue(fake.board);
    await mount({ ...baseState(), products: [], stockLevels: [], stockMovements: [] });
    expect(fake.readBoard).toHaveBeenCalled();
    expect(store.state.products).toEqual([]);
    expect(store.state.stockLevels).toEqual([]);
    expect(store.state.stockAlerts).toEqual([]);
    expect(section('#test-settings #stock').textContent).toContain('Aucun produit configuré');
  });

  it('conserve les exemples uniquement dans une démonstration locale sans produits', async () => {
    await mount({ ...baseState(), products: [], stockLevels: [], stockMovements: [], demoMode: false });
    expect(store.isLocalStockDemo).toBe(true);
    expect(store.state.products).toHaveLength(5);
    expect(store.state.products.every((p) => p.id.startsWith('prod-init-'))).toBe(true);
    expect(store.state.stockAlerts.length).toBeGreaterThan(0);
    expect(section('#test-settings #stock').textContent).toContain('Simulation locale');
  });

  it('laisse les commandes de réception, consommation et inventaire passer par les RPC existantes', async () => {
    fake.source = 'supabase';
    fake.authKind = 'supabase';
    fake.identity = identity;
    fake.commands = serverCommands();
    fake.board = board(true);
    fake.readBoard.mockResolvedValue(fake.board);
    await mount({ ...baseState(), products: [], stockLevels: [], stockMovements: [] });
    expect(store.state.products[0].name).toBe('Shampoing');
    expect(section('#test-settings #stock').querySelectorAll('button[aria-label^="Simuler"]')).toHaveLength(0);

    const receipt = { orderId: 'order-1', receiptKey: 'receipt-1', lines: [{ productId: product.id, qty: 5, unitCostMinor: 100 }] };
    await act(async () => {
      await store.receivePurchaseLines(receipt);
      await store.consumeWash('wash-1');
      await store.closeInventory('inventory-1');
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(1, 'receive_purchase_lines', {
      p_order_id: 'order-1', p_lines: [{ product_id: product.id, qty: 5, unit_cost_minor: 100 }], p_receipt_key: 'receipt-1',
    });
    expect(fake.rpc).toHaveBeenNthCalledWith(2, 'consume_products_for_wash', { p_wash_id: 'wash-1' });
    expect(fake.rpc).toHaveBeenNthCalledWith(3, 'close_inventory_session', { p_session_id: 'inventory-1' });
    expect(store.state.stockMovements).toEqual([]); // L'UI attend le board serveur ; aucun quick_adjustment local.

    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Réception refusée par le serveur' } });
    const readsBefore = fake.readBoard.mock.calls.length;
    await act(async () => {
      await expect(store.receivePurchaseLines(receipt)).rejects.toThrow('Réception refusée par le serveur');
    });
    expect(fake.readBoard).toHaveBeenCalledTimes(readsBefore);
    expect(store.state.stockLevels[0].qtyOnHand).toBe(2);
    expect(store.state.stockMovements).toEqual([]);
  });
});
