// ─── Prompt 10 : port QA / Storage / pagination serveur ───────────────────────
// Toutes les opérations passent par RPC ou Storage Supabase. Aucun identifiant
// brut d'entreprise n'est construit dans le navigateur : le chemin Storage est
// dérivé de auth.uid() par station_asset_path().

import { supabase } from './supabase';
import { idempotencyKey, NetworkError, withRetry } from './network';
import { optimizeStationLogo } from './image';

const BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'station-assets';

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
  signedUrl: string;
  idempotencyKey: string;
  optimized: boolean;
  bytes: number;
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
  return expectObject<QaBoard>(await rpc<unknown>('my_qa_board'), 'Board QA');
}

export async function fetchWashesPage(limit = 20, offset = 0): Promise<WashPage> {
  return expectObject<WashPage>(
    await rpc<unknown>('my_washes_page', { p_limit: limit, p_offset: offset }),
    'Pagination des lavages',
  );
}

export function claimIdempotency(rpcName: string, key: string): Promise<{ firstCall: boolean; rpc: string }> {
  return rpc('claim_rpc_idempotency', { p_rpc: rpcName, p_key: key });
}

export async function uploadStationLogo(file: File): Promise<LogoUploadResult> {
  const c = client();
  const key = idempotencyKey('logo');
  await claimIdempotency('station_asset_path', key);

  const optimized = await optimizeStationLogo(file);
  const path = await rpc<string>('station_asset_path', { p_filename: optimized.name });
  await withRetry(async () => {
    const result = await c.storage.from(BUCKET).upload(path, optimized.body, {
      upsert: true,
      contentType: optimized.contentType,
    });
    if (result.error) throw result.error;
    return result;
  }, { label: 'upload du logo' });

  const signed = await c.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signed.error) throw new NetworkError('URL signée indisponible', signed.error);
  return {
    path,
    signedUrl: signed.data.signedUrl,
    idempotencyKey: key,
    optimized: optimized.optimized,
    bytes: optimized.bytes,
  };
}
