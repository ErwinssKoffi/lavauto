import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGO_MAX_BYTES, isStationLogoPath, validateStationLogo } from '../../src/lib/image';

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  sign: vi.fn(),
  optimize: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: fake.rpc, storage: { from: fake.from } },
}));
vi.mock('../../src/lib/image', async (original) => ({
  ...(await original<typeof import('../../src/lib/image')>()),
  optimizeStationLogo: fake.optimize,
}));

import {
  getStationLogoSignedUrl, LOGO_URL_TTL_SECONDS, saveStationLogoPath, uploadStationLogo,
} from '../../src/lib/qa';

const company = '11111111-1111-4111-8111-111111111111';
const storedPath = `${company}/logo-a.webp`;

beforeEach(() => {
  vi.clearAllMocks();
  fake.from.mockReturnValue({ upload: fake.upload, createSignedUrl: fake.sign });
  fake.rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === 'station_asset_path') return { data: `${company}/${args.p_filename}`, error: null };
    if (name === 'claim_rpc_idempotency') return { data: { firstCall: true }, error: null };
    return { data: null, error: null };
  });
  fake.upload.mockResolvedValue({ data: {}, error: null });
  fake.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed?token=temporary' }, error: null });
  fake.optimize.mockImplementation(async (file: File) => ({
    body: file, contentType: file.type, name: file.name, optimized: false, bytes: file.size,
  }));
});

describe('logo privé — validation', () => {
  it('accepte uniquement PNG/JPEG/WebP non vides et au plus 5 Mo', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateStationLogo({ type, size: LOGO_MAX_BYTES })).toBeNull();
    }
    expect(validateStationLogo({ type: 'image/gif', size: 10 })).toMatch(/PNG, JPEG ou WebP/);
    expect(validateStationLogo({ type: 'image/png', size: 0 })).toMatch(/vide/);
    expect(validateStationLogo({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/5 Mo/);
  });

  it('reconnaît un chemin serveur et rejette URL, chemins traversants et données', () => {
    expect(isStationLogoPath(storedPath)).toBe(true);
    for (const path of ['https://example.com/logo.png', 'data:image/png;base64,AAAA', `${company}/../logo.png`, `${company}/`, '', null]) {
      expect(isStationLogoPath(path)).toBe(false);
    }
  });

  it('refuse un fichier non conforme avant tout appel réseau', async () => {
    const invalid = new File(['not an image'], 'logo.gif', { type: 'image/gif' });
    await expect(uploadStationLogo(invalid)).rejects.toThrow(/PNG, JPEG ou WebP/);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.upload).not.toHaveBeenCalled();
  });
});

describe('logo privé — Storage et association', () => {
  it('optimise puis charge dans le bucket privé avec un nouveau chemin, sans signer', async () => {
    const file = new File(['image bytes'], 'Même nom.png', { type: 'image/png' });
    const webp = new Blob(['webp'], { type: 'image/webp' });
    fake.optimize.mockResolvedValue({ body: webp, contentType: 'image/webp', name: 'Même nom.webp', optimized: true, bytes: 4 });

    const first = await uploadStationLogo(file);
    const second = await uploadStationLogo(file);
    expect(fake.optimize).toHaveBeenCalledWith(file);
    expect(fake.from).toHaveBeenCalledWith('station-assets');
    expect(fake.rpc).toHaveBeenCalledWith('claim_rpc_idempotency', expect.objectContaining({ p_rpc: 'station_asset_path', p_key: first.idempotencyKey }));
    expect(first.path).toBe(`${company}/${first.idempotencyKey}.webp`);
    expect(second.path).not.toBe(first.path);
    expect(fake.upload).toHaveBeenCalledWith(first.path, webp, { upsert: true, contentType: 'image/webp' });
    expect(fake.sign).not.toHaveBeenCalled();
    expect(first).not.toHaveProperty('signedUrl');
    expect(first.optimized).toBe(true);
  });

  it('réutilise le même chemin lors d’un retry réseau', async () => {
    fake.upload.mockResolvedValueOnce({ error: { message: 'network timeout' } }).mockResolvedValueOnce({ data: {}, error: null });
    const result = await uploadStationLogo(new File(['png'], 'logo.png', { type: 'image/png' }));
    expect(fake.upload).toHaveBeenCalledTimes(2);
    expect(fake.upload.mock.calls[0][0]).toBe(result.path);
    expect(fake.upload.mock.calls[1][0]).toBe(result.path);
  });

  it('ne signe que le chemin demandé, pour une heure, sans persister l’URL', async () => {
    await saveStationLogoPath('station-1', storedPath);
    expect(fake.rpc).toHaveBeenCalledWith('save_station_logo', { p_station_id: 'station-1', p_path: storedPath });
    expect(fake.sign).not.toHaveBeenCalled();
    const url = await getStationLogoSignedUrl(storedPath);
    expect(url).toContain('token=temporary');
    expect(fake.sign).toHaveBeenCalledWith(storedPath, LOGO_URL_TTL_SECONDS);
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain('token=temporary');
    await saveStationLogoPath('station-1', null);
    expect(fake.rpc).toHaveBeenCalledWith('save_station_logo', { p_station_id: 'station-1', p_path: null });
  });

  it('refuse les URL même si elles sont soumises directement aux services', async () => {
    await expect(getStationLogoSignedUrl('https://example.com/logo.png')).rejects.toThrow(/Chemin/);
    await expect(saveStationLogoPath('station-1', 'https://example.com/logo.png')).rejects.toThrow(/Chemin/);
    expect(fake.sign).not.toHaveBeenCalled();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it('propage les échecs d’upload, d’association et de signature', async () => {
    fake.upload.mockResolvedValueOnce({ error: { message: 'permission denied', status: 403 } });
    await expect(uploadStationLogo(new File(['png'], 'logo.png', { type: 'image/png' }))).rejects.toThrow(/Envoi du logo/);
    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(saveStationLogoPath('station-1', storedPath)).rejects.toThrow(/save_station_logo/);
    fake.sign.mockResolvedValueOnce({ data: null, error: { message: 'permission denied', status: 403 } });
    await expect(getStationLogoSignedUrl(storedPath)).rejects.toThrow(/Aperçu du logo/);
  });
});
