// ─── Prompt 10 : optimisation des images avant Storage ────────────────────────
// Optimisation best-effort : WebP redimensionne a 512 px si le navigateur le
// prend en charge et si le resultat est plus leger, sinon fichier d'origine.

export const LOGO_MAX_EDGE = 512;
export const LOGO_WEBP_QUALITY = 0.82;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Les mêmes limites s'appliquent à tous les points d'entrée Storage. */
export function validateStationLogo(file: Pick<File, 'type' | 'size'>): string | null {
  if (!LOGO_ACCEPT.split(',').includes(file.type)) {
    return 'Choisissez une image PNG, JPEG ou WebP.';
  }
  if (file.size === 0) return 'Le fichier sélectionné est vide.';
  if (file.size > LOGO_MAX_BYTES) return 'Le logo ne doit pas dépasser 5 Mo.';
  return null;
}

/** Un chemin Storage, jamais une URL externe ou une URL signée. */
export function isStationLogoPath(path: unknown): path is string {
  return typeof path === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]*$/.test(path);
}

/** Nom de fichier conserve cote serveur quand le WebP est retenu. */
export function logoObjectName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, '').trim() || 'logo';
  return `${stem}.webp`;
}

export interface OptimizedLogo {
  body: Blob;
  contentType: string;
  name: string;
  optimized: boolean;
  bytes: number;
}

/**
 * Recompression best-effort : si le navigateur ne fournit pas Canvas / WebP ou
 * si le resultat n'est pas plus leger, le fichier d'origine est conserve tel
 * quel. Aucune exception utilisateur n'est levee pour un simple echec codec.
 */
export async function optimizeStationLogo(file: File): Promise<OptimizedLogo> {
  const fallback = (): OptimizedLogo => ({
    body: file,
    contentType: file.type || 'application/octet-stream',
    name: file.name,
    optimized: false,
    bytes: file.size,
  });

  if (
    typeof document === 'undefined'
    || typeof createImageBitmap !== 'function'
    || !/^image\/(png|jpeg|webp)$/.test(file.type)
  ) return fallback();

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return fallback();
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', LOGO_WEBP_QUALITY);
    });
    // Certains navigateurs ignorent le format demande et renvoient un PNG :
    // ne jamais etiqueter un tel resultat comme WebP.
    if (!blob || blob.size === 0 || blob.type !== 'image/webp' || blob.size >= file.size) return fallback();
    return {
      body: blob,
      contentType: 'image/webp',
      name: logoObjectName(file.name),
      optimized: true,
      bytes: blob.size,
    };
  } catch {
    return fallback();
  } finally {
    bitmap?.close?.();
  }
}
