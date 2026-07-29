/**
 * Geração de tokens da API no navegador.
 *
 * O valor em claro nunca é enviado ao servidor: gravamos apenas o sha256.
 * Espelha app/security.py no backend — se mudar um lado, mude o outro.
 */

const PREFIX = "vct_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;
const STORAGE_KEY = "vct.tokens";

function base64UrlNoPadding(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${PREFIX}${base64UrlNoPadding(bytes)}`;
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw.trim()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function displayPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LENGTH);
}

/* ---------------------------------------------------------------------------
   Cópia local dos tokens em claro.

   O servidor só guarda o hash, então guardamos o valor no localStorage deste
   navegador apenas para o playground funcionar sem precisar colar o token toda
   vez. Some ao limpar os dados do navegador — o token em si continua válido.
--------------------------------------------------------------------------- */

type LocalTokens = Record<string, string>;

function readAll(): LocalTokens {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as LocalTokens;
  } catch {
    return {};
  }
}

export function rememberToken(id: string, raw: string): void {
  const all = readAll();
  all[id] = raw;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function recallToken(id: string): string | null {
  return readAll()[id] ?? null;
}

export function forgetToken(id: string): void {
  const all = readAll();
  delete all[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
