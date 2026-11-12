// ─── Prompt 10 : optimisation des images avant Storage ────────────────────────
// Le navigateur redimensionne et recompresse le logo avant l'envoi : le bucket
// ne recoit qu'un WebP de 512 px maximum. Aucun identifiant de tenant, aucun
// secret et aucun traitement serveur supplementaire ne sont necessaires.

export const LOGO_MAX_EDGE = 512;
export const LOGO_WEBP_QUALITY = 0.82;

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
    if (!blob || blob.size >= file.size) return fallback();
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
