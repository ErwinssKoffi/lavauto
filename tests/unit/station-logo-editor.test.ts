// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  upload: vi.fn(),
  save: vi.fn(),
  sign: vi.fn(),
  setPath: vi.fn(),
  notify: vi.fn(),
  updateStation: vi.fn(),
}));

vi.mock('../../src/lib/store', () => ({ useStore: () => fake.store, DEFAULT_DAYS: [] }));
vi.mock('../../src/lib/supabase', () => ({ isSupabaseConfigured: true }));
vi.mock('../../src/lib/qa', () => ({
  uploadStationLogo: fake.upload,
  saveStationLogoPath: fake.save,
  getStationLogoSignedUrl: fake.sign,
  LOGO_URL_TTL_SECONDS: 3600,
}));

import { StationLogoEditor } from '../../src/components/StationLogoEditor';
import { LOGO_MAX_BYTES } from '../../src/lib/image';
import { LOGO_REFRESH_MS } from '../../src/lib/useStationLogoUrl';
import Settings from '../../src/pages/Settings';

const pathA = '11111111-1111-4111-8111-111111111111/logo-a.webp';
const pathB = '11111111-1111-4111-8111-111111111111/logo-b.webp';
let container: HTMLDivElement;
let root: Root;
let view: React.ReactElement;

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

function station(path: string | null = null) {
  return {
    id: 'station-a', companyId: 'company-a', name: 'Station A', address: '', city: '', phone: '',
    logoPath: path, hours: [], cashRequiresOpen: true, maxCashierDiscount: 0, commissionRate: 0, monthlyTarget: 0,
  };
}

function rerender() { root.render(view); }
async function render(element = React.createElement(StationLogoEditor)) {
  view = element;
  await act(async () => { rerender(); });
}
function input(): HTMLInputElement { return container.querySelector('input[type="file"]')!; }
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`Bouton introuvable : ${text}`);
  return found;
}
async function select(file: File) {
  Object.defineProperty(input(), 'files', { configurable: true, value: [file] });
  await act(async () => { input().dispatchEvent(new Event('change', { bubbles: true })); });
}
async function click(text: string) {
  await act(async () => { button(text).click(); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  fake.store = {
    state: { station: station(), company: null, session: { userId: 'user-a', stationId: 'station-a', companyId: 'company-a' }, auditLogs: [], stockAlerts: [], products: [], stockLevels: [] },
    dataSource: 'supabase', authKind: 'supabase', canWriteSubscription: true, setStationLogoPath: fake.setPath, notify: fake.notify,
    updateStation: fake.updateStation, updateCompany: vi.fn(), setHours: vi.fn(), resetAll: vi.fn(),
    updateStockThreshold: vi.fn(), adjustProductStock: vi.fn(),
  };
  fake.setPath.mockImplementation((_station: string, _user: string, path: string | null) => {
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = { ...state.station, logoPath: path };
    rerender();
  });
  fake.upload.mockResolvedValue({ path: pathA, optimized: true, bytes: 100, idempotencyKey: 'logo-id' });
  fake.save.mockResolvedValue(undefined);
  fake.sign.mockResolvedValue('https://storage.example/signed?token=one');
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

describe('éditeur de logo privé', () => {
  it('désactive le téléversement en mode local sans proposer de champ URL', async () => {
    fake.store.dataSource = 'local';
    fake.store.authKind = 'local';
    await render();
    expect(input().disabled).toBe(true);
    expect(button('Enregistrer le logo').disabled).toBe(true);
    expect(container.textContent).toContain('indisponible en mode local');
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(fake.upload).not.toHaveBeenCalled();
    expect(fake.sign).not.toHaveBeenCalled();
  });

  it('conserve l’aperçu mais bloque les mutations du logo en lecture seule', async () => {
    fake.store.canWriteSubscription = false;
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    await render();
    expect(input().disabled).toBe(true);
    expect(button('Enregistrer le logo').disabled).toBe(true);
    expect(button('Retirer le logo').disabled).toBe(true);
    expect(fake.sign).toHaveBeenCalled();
    await click('Retirer le logo');
    expect(fake.save).not.toHaveBeenCalled();
  });

  it('valide les formats, la taille et les fichiers vides avant l’envoi', async () => {
    await render();
    expect(input().accept).toBe('image/png,image/jpeg,image/webp');
    await select(new File(['gif'], 'logo.gif', { type: 'image/gif' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('PNG, JPEG ou WebP');
    expect(button('Enregistrer le logo').disabled).toBe(true);
    await select(new File([], 'vide.png', { type: 'image/png' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('vide');
    await select(new File([new Uint8Array(LOGO_MAX_BYTES + 1)], 'grand.png', { type: 'image/png' }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('5 Mo');
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it('enregistre le chemin, puis signe pour l’aperçu sans stocker l’URL', async () => {
    await render();
    const file = new File(['logo'], 'logo.png', { type: 'image/png' });
    await select(file);
    expect(button('Enregistrer le logo').disabled).toBe(false);
    await click('Enregistrer le logo');
    expect(fake.upload).toHaveBeenCalledWith(file);
    expect(fake.save).toHaveBeenCalledWith('station-a', pathA);
    expect(fake.setPath).toHaveBeenCalledWith('station-a', 'user-a', pathA);
    expect(fake.sign).toHaveBeenCalledWith(pathA);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('token=one');
    expect(JSON.stringify(fake.setPath.mock.calls)).not.toContain('token=one');
    expect(fake.notify).toHaveBeenCalledWith('success', expect.stringContaining('enregistré'));
    expect(button('Enregistrer le logo').disabled).toBe(true);
  });

  it('bloque les doubles soumissions pendant l’envoi et attend la confirmation', async () => {
    let finishUpload!: (value: unknown) => void;
    fake.upload.mockReturnValueOnce(new Promise((resolve) => { finishUpload = resolve; }));
    await render();
    await select(new File(['logo'], 'logo.png', { type: 'image/png' }));
    await click('Enregistrer le logo');
    expect(input().disabled).toBe(true);
    expect(button('Enregistrement…').disabled).toBe(true);
    expect(fake.save).not.toHaveBeenCalled();
    expect(fake.setPath).not.toHaveBeenCalled();
    await act(async () => { finishUpload({ path: pathA, optimized: true, bytes: 4, idempotencyKey: 'logo-id' }); });
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(fake.setPath).toHaveBeenCalledWith('station-a', 'user-a', pathA);
  });

  it('interrompt l’association si l’utilisateur ou la station change pendant l’envoi', async () => {
    let finishUpload!: (value: unknown) => void;
    fake.upload.mockReturnValueOnce(new Promise((resolve) => { finishUpload = resolve; }));
    await render();
    await select(new File(['logo'], 'logo.png', { type: 'image/png' }));
    await click('Enregistrer le logo');
    const state = fake.store.state as { session: { userId: string; stationId: string; companyId: string }; station: ReturnType<typeof station> };
    state.session = { userId: 'user-b', stationId: 'station-b', companyId: 'company-b' };
    state.station = { ...station(), id: 'station-b', companyId: 'company-b' };
    await render();
    await act(async () => { finishUpload({ path: pathA, optimized: true, bytes: 4, idempotencyKey: 'logo-id' }); });
    expect(fake.save).not.toHaveBeenCalled();
    expect(fake.setPath).not.toHaveBeenCalled();
    expect(fake.notify).not.toHaveBeenCalled();
  });

  it('ne signe pas une station qui ne correspond pas à la session courante', async () => {
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = { ...station(pathA), id: 'station-ancienne' };
    await render();
    expect(input().disabled).toBe(true);
    expect(fake.sign).not.toHaveBeenCalled();
  });

  it('affiche une erreur de signature sans effacer le chemin, puis réessaie', async () => {
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    fake.sign.mockRejectedValueOnce(new Error('hors ligne'));
    await render();
    expect(container.textContent).toContain('Impossible d’afficher le logo');
    expect(state.station.logoPath).toBe(pathA);
    expect(fake.setPath).not.toHaveBeenCalled();
    await click('Réessayer l’aperçu');
    expect(container.querySelector('img')?.getAttribute('src')).toContain('token=one');
  });

  it('ne change pas le logo si l’upload ou son association échoue, et permet de réessayer', async () => {
    fake.upload.mockRejectedValueOnce(new Error('Envoi refusé'));
    await render();
    await select(new File(['logo'], 'logo.png', { type: 'image/png' }));
    await click('Enregistrer le logo');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Envoi refusé');
    expect(fake.save).not.toHaveBeenCalled();
    expect(fake.setPath).not.toHaveBeenCalled();
    expect(button('Enregistrer le logo').disabled).toBe(false);

    fake.save.mockRejectedValueOnce(new Error('RLS'));
    await click('Enregistrer le logo');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('association à la station');
    expect(fake.setPath).not.toHaveBeenCalled();
    expect(fake.notify).not.toHaveBeenCalled();
    await click('Enregistrer le logo');
    expect(fake.setPath).toHaveBeenCalledWith('station-a', 'user-a', pathA);
  });

  it('recrée une URL à l’affichage, la renouvelle et permet de réessayer après une erreur', async () => {
    vi.useFakeTimers();
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    fake.sign.mockResolvedValueOnce('https://storage.example/one').mockResolvedValueOnce('https://storage.example/two');
    await render();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/one');
    await act(async () => { await vi.advanceTimersByTimeAsync(LOGO_REFRESH_MS); });
    expect(fake.sign).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/two');
    await act(async () => { container.querySelector('img')!.dispatchEvent(new Event('error')); });
    expect(container.textContent).toContain('Impossible d’afficher le logo');
    fake.sign.mockResolvedValueOnce('https://storage.example/three');
    await click('Réessayer l’aperçu');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/three');
  });

  it('ne réutilise pas l’URL signée quand la session change', async () => {
    let finish!: (url: string) => void;
    fake.sign.mockResolvedValueOnce('https://storage.example/user-a')
      .mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    const state = fake.store.state as { station: ReturnType<typeof station>; session: { userId: string; stationId: string; companyId: string } };
    state.station = station(pathA);
    await render();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/user-a');
    state.session = { userId: 'user-b', stationId: 'station-a', companyId: 'company-a' };
    await render();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Chargement de l’aperçu');
    await act(async () => { finish('https://storage.example/user-b'); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/user-b');
    expect(fake.sign).toHaveBeenCalledTimes(2);
  });

  it('ignore une signature arrivée après le changement de chemin', async () => {
    const resolvers: Record<string, (value: string) => void> = {};
    fake.sign.mockImplementation((path: string) => new Promise<string>((resolve) => { resolvers[path] = resolve; }));
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    await render();
    state.station = station(pathB);
    await render();
    await act(async () => { resolvers[pathB]('https://storage.example/b'); });
    await act(async () => { resolvers[pathA]('https://storage.example/a'); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/b');
  });

  it('retire la référence sans prétendre supprimer le fichier', async () => {
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    await render();
    await click('Retirer le logo');
    expect(fake.save).toHaveBeenCalledWith('station-a', null);
    expect(fake.setPath).toHaveBeenCalledWith('station-a', 'user-a', null);
    expect(container.querySelector('img')).toBeNull();
  });

  it('enregistrer les coordonnées dans Paramètres ne remplace pas le chemin du logo', async () => {
    const state = fake.store.state as { station: ReturnType<typeof station> };
    state.station = station(pathA);
    await render(React.createElement(MemoryRouter, null, React.createElement(Settings)));
    const identityButton = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enregistrer');
    expect(identityButton).toBeDefined();
    await act(async () => { identityButton!.click(); });
    expect(fake.updateStation).toHaveBeenCalledTimes(1);
    expect(fake.updateStation.mock.calls[0][0]).not.toHaveProperty('logoPath');
    expect(fake.updateStation.mock.calls[0][0]).not.toHaveProperty('logoUrl');
  });
});
