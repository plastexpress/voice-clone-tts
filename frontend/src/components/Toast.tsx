/** Notificações no canto inferior direito. */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { IconCheck, IconX } from "./icons";
import { cx } from "./ui";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === "error" ? 6000 : 3500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error"),
      info: (message) => push(message, "info"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)]",
              toast.tone === "error" ? "border-danger/40" : "border-line",
            )}
          >
            <span
              className={cx(
                "mt-0.5 shrink-0",
                toast.tone === "success" && "text-success",
                toast.tone === "error" && "text-danger",
                toast.tone === "info" && "text-accent",
              )}
            >
              {toast.tone === "error" ? <IconX size={15} /> : <IconCheck size={15} />}
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{toast.message}</p>
            <button
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
              aria-label="Fechar"
            >
              <IconX size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return context;
}
