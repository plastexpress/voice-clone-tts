/** Componentes base — visual sóbrio, bordas finas, muito espaço em branco. */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { IconCheck, IconCopy } from "./icons";
import { useState } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-accent text-white hover:opacity-90 border border-transparent",
    default: "bg-surface text-ink border border-line hover:bg-hover",
    ghost: "bg-transparent text-muted border border-transparent hover:bg-hover hover:text-ink",
    danger: "bg-transparent text-danger border border-line hover:bg-danger-soft",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-ring select-none",
        size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm",
        variants[variant],
        (disabled || loading) && "opacity-50 pointer-events-none",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin-slow" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------- Input */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-line bg-subtle px-2.5 py-1.5 text-sm text-ink",
        "placeholder:text-faint transition-shadow focus-ring",
        "focus:border-accent focus:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full rounded-md border border-line bg-subtle px-3 py-2 text-sm leading-relaxed text-ink",
        "placeholder:text-faint transition-shadow focus-ring resize-y",
        "focus:border-accent focus:bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "w-full appearance-none rounded-md border border-line bg-subtle px-2.5 py-1.5 text-sm text-ink",
        "transition-shadow focus-ring focus:border-accent focus:bg-surface",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23787774%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-8",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-hover focus-ring"
    >
      <span
        className={cx(
          "mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-3",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs leading-snug text-faint">{hint}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------- Badge */

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "purple";

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-hover text-muted",
    accent: "bg-accent-soft text-accent",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    purple: "bg-purple-soft text-purple",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]",
        padded && "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: BadgeTone;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "text-muted",
    accent: "text-accent",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    purple: "text-purple",
  };
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-faint">
        {icon && <span className={tones[tone]}>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-faint">{hint}</div>}
    </Card>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-faint">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- CopyButton */

export function CopyButton({
  value,
  label = "Copiar",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={copy}
      icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      title="Copiar"
    >
      {copied ? "Copiado" : label}
    </Button>
  );
}

/* ------------------------------------------------------------------- Table */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        "border-b border-line px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wide text-faint",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("border-b border-line px-3 py-2 align-middle text-ink", className)}>{children}</td>;
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="my-4 border-t border-line" />;
  return (
    <div className="my-5 flex items-center gap-3">
      <hr className="flex-1 border-t border-line" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <hr className="flex-1 border-t border-line" />
    </div>
  );
}
