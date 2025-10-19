/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MINOOTS_API_BASE?: string;
  readonly VITE_MINOOTS_API_KEY?: string;
  readonly VITE_MINOOTS_USE_CREDENTIALS?: string;
  readonly VITE_MINOOTS_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
