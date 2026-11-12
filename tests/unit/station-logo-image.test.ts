// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGO_WEBP_QUALITY, optimizeStationLogo } from '../../src/lib/image';

const file = () => new File(['image source assez grande'], 'logo.png', { type: 'image/png' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('optimisation facultative du logo', () => {
  function codec(output: Blob) {
    const close = vi.fn();
    const drawImage = vi.fn();
    let dimensions: number[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1024, height: 256, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
      expect(type).toBe('image/webp');
      expect(quality).toBe(LOGO_WEBP_QUALITY);
      dimensions = [this.width, this.height];
      callback(output);
    });
    return { close, drawImage, toBlob, dimensions: () => dimensions };
  }

  it('redimensionne et utilise le WebP lorsqu’il est effectivement plus léger', async () => {
    const blob = new Blob(['webp'], { type: 'image/webp' });
    const canvas = codec(blob);
    const result = await optimizeStationLogo(file());
    expect(canvas.dimensions()).toEqual([512, 128]);
    expect(canvas.drawImage).toHaveBeenCalledOnce();
    expect(canvas.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ body: blob, contentType: 'image/webp', name: 'logo.webp', optimized: true, bytes: blob.size });
  });

  it('conserve le fichier original si le navigateur renvoie un PNG au lieu du WebP demandé', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = codec(png);
    const original = file();
    const result = await optimizeStationLogo(original);
    expect(canvas.toBlob).toHaveBeenCalledOnce();
    expect(canvas.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ body: original, contentType: 'image/png', optimized: false, bytes: original.size });
  });

  it('conserve le fichier original si la recompression est plus lourde ou impossible', async () => {
    codec(new Blob(['un WebP beaucoup plus lourd que le fichier original'], { type: 'image/webp' }));
    const original = file();
    expect((await optimizeStationLogo(original)).body).toBe(original);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('codec indisponible')));
    expect((await optimizeStationLogo(original)).body).toBe(original);
  });
});
