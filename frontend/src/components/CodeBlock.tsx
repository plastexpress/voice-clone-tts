/** Bloco de código monoespaçado com botão de copiar. */

import { CopyButton, cx } from "./ui";

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx("overflow-hidden rounded-md border border-line bg-subtle", className)}>
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
          {label || "código"}
        </span>
        <CopyButton value={code} label="" />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}
