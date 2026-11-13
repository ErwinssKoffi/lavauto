import type { AppState, Session } from '../../types';
import { getDataSource } from '../adapters/DataAdapter';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { AuthPort } from './AuthPort';
import { LocalAuthAdapter, identityFromState, type LocalAuthHooks } from './LocalAuthAdapter';
import { ApiAuthAdapter } from './ApiAuthAdapter';
import { SupabaseAuthAdapter } from './SupabaseAuthAdapter';

// ─── Sélection du port Auth (Prompt 04) ──────────────────────────────────────
// Le mode `api` utilise les sessions HTTP-only PostgreSQL côté serveur.
// Le mode `supabase` exige la clé publishable ; aucun repli silencieux.
// `VITE_WG_TEST_AUTH` est une constante de COMPILATION réservée au harnais
// JSDOM (`scripts/check.cjs`) : elle n'est pas définie dans la build Vite.

const TEST_AUTH = import.meta.env.VITE_WG_TEST_AUTH === '1';

interface TestBridge {
  __WG_TEST_SESSION__?: { session?: Session | null };
}

function testIdentity(hooks: LocalAuthHooks) {
  if (!TEST_AUTH || typeof window === 'undefined') return null;
  const bridge = window as unknown as TestBridge;
  const session = bridge.__WG_TEST_SESSION__?.session ?? null;
  const state: AppState = { ...hooks.getState(), session };
  return identityFromState(state, session);
}

export function getAuthPort(hooks: LocalAuthHooks): AuthPort {
  if (TEST_AUTH) return new LocalAuthAdapter(hooks, testIdentity(hooks));

  const source = getDataSource();
  if (source === 'api') return new ApiAuthAdapter();
  if (source === 'supabase') {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Mode Supabase : VITE_SUPABASE_URL et la clé publishable sont requises.');
    }
    return new SupabaseAuthAdapter(supabase);
  }
  return new LocalAuthAdapter(hooks);
}
