// ─── Prompt 10 : port QA / Storage / pagination serveur ───────────────────────
// Toutes les opérations passent par RPC ou Storage Supabase. Aucun identifiant
// brut d'entreprise n'est construit dans le navigateur : le chemin Storage est
// dérivé de auth.uid() par station_asset_path().

import { supabase } from './supabase';
import { getDataSource } from '../services/adapters/DataAdapter';
import { apiFetch } from '../services/api/apiClient';
import { idempotencyKey, NetworkError, withRetry } from './network';
import { isStationLogoPath, optimizeStationLogo, validateStationLogo } from './image';

const BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'station-assets';
export const LOGO_URL_TTL_SECONDS = 3600;

export interface QaBoard {
  migrations: number;
  tables: number;
  views: number;
  permissions: number;
  rolePermissions: number;
  indexes: number;
  storageBucket: boolean;
  storagePolicies: number;
  bucketPolicies: number;
  anonStorageRevoked: boolean;
  anonStorageSelectGrant: boolean;
  authenticatedBucketInsertRevoked: boolean;
  idempotencyTable: boolean;
  rpcCount: number;
  quotaTriggers: number;
  rules: Record<string, string>;
}

export interface WashPageRow {
  washId: string;
  number: string;
  status: string;
  total: number;
  paid: number;
  createdAt: string;
  stationId: string;
  customerName: string | null;
  plate: string | null;
}

export interface WashPage {
  rows: WashPageRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  rules: Record<string, string>;
}

export interface LogoUploadResult {
  path: string;
  idempotencyKey: string;
  optimized: boolean;
  bytes: number;
}

function isApiMode(): boolean {
  return getDataSource() === 'api';
}

function logoBucket() {
  if (BUCKET !== 'station-assets') {
    throw new NetworkError('Le bucket privé station-assets est requis pour les logos.');
  }
  return client().storage.from(BUCKET);
}

function client() {
  if (!supabase) throw new NetworkError('Client Supabase non configuré');
  return supabase;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = client();
  const result = await withRetry(async () => {
    const response = await c.rpc(name, args);
    if (response.error) throw response.error;
    return response;
  }, { label: name });
  return result.data as T;
}

function expectObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NetworkError(`${label} : réponse serveur inattendue`);
  }
  return value as T;
}

export async function fetchQaBoard(): Promise<QaBoard> {
  if (isApiMode()) return expectObject<QaBoard>(await apiFetch('/api/qa/board'), 'Board QA');
  return expectObject<QaBoard>(await rpc<unknown>('my_qa_board'), 'Board QA');
}

export async function fetchWashesPage(limit = 20, offset = 0): Promise<WashPage> {
  if (isApiMode()) {
    return expectObject<WashPage>(
      await apiFetch(`/api/qa/washes-page?limit=${limit}&offset=${offset}`),
      'Pagination des lavages',
    );
  }
  return expectObject<WashPage>(
    await rpc<unknown>('my_washes_page', { p_limit: limit, p_offset: offset }),
    'Pagination des lavages',
  );
}

export function claimIdempotency(rpcName: string, key: string): Promise<{ firstCall: boolean; rpc: string }> {
  return rpc('claim_rpc_idempotency', { p_rpc: rpcName, p_key: key });
}

/** L'URL signée n'est pas une donnée persistante : seul le chemin est renvoyé. */
export async function uploadStationLogo(file: File): Promise<LogoUploadResult> {
  const validationError = validateStationLogo(file);
  if (validationError) throw new Error(validationError);
  const key = idempotencyKey('logo');

  if (isApiMode()) {
    const optimized = await optimizeStationLogo(file);
    const extension = optimized.contentType === 'image/webp' ? 'webp'
      : optimized.contentType === 'image/png' ? 'png' : 'jpg';
    const claimed = await apiFetch<{ path: string }>('/api/storage/station-logo/claim', {
      method: 'POST',
      body: JSON.stringify({ key, filename: `${key}.${extension}` }),
    });
    if (!isStationLogoPath(claimed.path)) throw new NetworkError('Chemin de logo renvoyé par le serveur invalide');
    await withRetry(async () => {
      const res = await fetch(`/api/storage/station-logo/upload?path=${encodeURIComponent(claimed.path)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': optimized.contentType },
        body: optimized.body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    }, { label: 'Envoi du logo' });
    return {
      path: claimed.path,
      idempotencyKey: key,
      optimized: optimized.optimized,
      bytes: optimized.bytes,
    };
  }

  const bucket = logoBucket();
  await claimIdempotency('station_asset_path', key);

  const optimized = await optimizeStationLogo(file);
  const extension = optimized.contentType === 'image/webp' ? 'webp'
    : optimized.contentType === 'image/png' ? 'png' : 'jpg';
  const path = await rpc<string>('station_asset_path', { p_filename: `${key}.${extension}` });
  if (!isStationLogoPath(path)) throw new NetworkError('Chemin de logo renvoyé par le serveur invalide');
  await withRetry(async () => {
    const result = await bucket.upload(path, optimized.body, {
      upsert: true,
      contentType: optimized.contentType,
    });
    if (result.error) throw result.error;
    return result;
  }, { label: 'Envoi du logo' });

  return {
    path,
    idempotencyKey: key,
    optimized: optimized.optimized,
    bytes: optimized.bytes,
  };
}

/** Associe uniquement un objet privé existant à une station autorisée. */
export async function saveStationLogoPath(stationId: string, path: string | null): Promise<void> {
  if (path !== null && !isStationLogoPath(path)) throw new Error('Chemin de logo invalide.');
  if (isApiMode()) {
    await apiFetch('/api/storage/station-logo/save', {
      method: 'POST',
      body: JSON.stringify({ stationId, path }),
    });
    return;
  }
  await rpc('save_station_logo', { p_station_id: stationId, p_path: path });
}

/** Les URL temporaires ne sont générées qu'au moment de l'affichage. */
export async function getStationLogoSignedUrl(path: string): Promise<string> {
  if (!isStationLogoPath(path)) throw new Error('Chemin de logo invalide.');
  if (isApiMode()) {
    return `/api/storage/station-logo/file?path=${encodeURIComponent(path)}`;
  }
  const bucket = logoBucket();
  const signed = await withRetry(async () => {
    const result = await bucket.createSignedUrl(path, LOGO_URL_TTL_SECONDS);
    if (result.error) throw result.error;
    if (!result.data?.signedUrl) throw new Error('URL signée absente');
    return result.data.signedUrl;
  }, { label: 'Aperçu du logo' });
  return signed;
}
