/**
 * Configuração de runtime.
 *
 * O container escreve /config.js no boot (docker-entrypoint.sh), então dá para
 * mudar a URL pública da API sem rebuildar a imagem.
 */

export type RuntimeConfig = {
  /** Base do PocketBase (proxy do nginx). */
  pbBase: string;
  /** Base do backend de TTS (proxy do nginx). */
  apiBase: string;
  /** URL que os clientes externos usam — aparece nos exemplos de código. */
  publicApiUrl: string;
  appName: string;
};

declare global {
  interface Window {
    __VCT_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const injected = typeof window !== "undefined" ? window.__VCT_CONFIG__ ?? {} : {};

export const config: RuntimeConfig = {
  pbBase: injected.pbBase || "/pb",
  apiBase: injected.apiBase || "/api",
  publicApiUrl: injected.publicApiUrl || `${window.location.protocol}//${window.location.hostname}:8096`,
  appName: injected.appName || "Voice Clone TTS",
};
