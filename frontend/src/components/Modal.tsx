/** Diálogo centralizado, fecha com Esc ou clique fora. */

import { useEffect } from "react";
import type { ReactNode } from "react";
import { IconX } from "./icons";
import { cx } from "./ui";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-[8vh] backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "animate-fade-in w-full rounded-lg border border-line bg-surface shadow-[var(--shadow-pop)]",
          widths[width],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] leading-snug text-faint">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 shrink-0 rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label="Fechar"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
  danger = true,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-medium transition-colors hover:bg-hover"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cx(
              "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-white transition-opacity hover:opacity-90",
              danger ? "bg-danger" : "bg-accent",
              loading && "pointer-events-none opacity-60",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-muted">{message}</div>
    </Modal>
  );
}
