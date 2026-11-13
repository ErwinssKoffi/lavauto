/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'local' | 'supabase' | 'api';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Bucket Storage privé du Prompt 10 ; valeur par défaut `station-assets`. */
  readonly VITE_SUPABASE_STORAGE_BUCKET?: string;
  /** Constante de compilation du harnais JSDOM / E2E ; jamais en production. */
  readonly VITE_WG_TEST_AUTH?: '1';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
