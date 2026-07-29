import PocketBase from "pocketbase";
import { config } from "./config";

/** Cliente único do PocketBase (sessão salva no localStorage pelo SDK). */
export const pb = new PocketBase(config.pbBase);

pb.autoCancellation(false);

export function fileUrl(record: { id: string; collectionId?: string; collectionName?: string }, filename: string): string {
  if (!filename) return "";
  return pb.files.getURL(record as never, filename);
}

/** Mensagem de erro legível a partir de uma falha do PocketBase. */
export function pbError(error: unknown, fallback = "Algo deu errado"): string {
  const err = error as { message?: string; response?: { message?: string; data?: Record<string, { message?: string }> } };
  const data = err?.response?.data;
  if (data && typeof data === "object") {
    const first = Object.entries(data)[0];
    if (first) {
      const [field, detail] = first;
      if (detail?.message) return `${field}: ${detail.message}`;
    }
  }
  return err?.response?.message || err?.message || fallback;
}
