/** Estrutura da aplicação: sidebar fixa + área de conteúdo. */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { config } from "../lib/config";
import { useAuth } from "../store/auth";
import { useTheme } from "../store/theme";
import type { SystemStatus } from "../lib/types";
import {
  IconChip,
  IconDatabase,
  IconHome,
  IconKey,
  IconList,
  IconLogout,
  IconMic,
  IconMoon,
  IconSettings,
  IconSparkles,
  IconSpellcheck,
  IconSun,
  IconX,
} from "./icons";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Visão geral", icon: IconHome, end: true },
  { to: "/playground", label: "Playground", icon: IconSparkles, end: false },
  { to: "/tokens", label: "Tokens", icon: IconKey, end: false },
  { to: "/voices", label: "Clones de voz", icon: IconMic, end: false },
  { to: "/pronunciations", label: "Pronúncias", icon: IconSpellcheck, end: false },
  { to: "/cache", label: "Cache de áudio", icon: IconDatabase, end: false },
  { to: "/logs", label: "Requisições", icon: IconList, end: false },
  { to: "/settings", label: "Sistema", icon: IconSettings, end: false },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const data = await api.status();
        if (alive) setStatus(data);
      } catch {
        if (alive) setStatus(null);
      }
    }
    void poll();
    const timer = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const initials = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full bg-canvas">
      {menuOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/25 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ----------------------------------------------------------- sidebar */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 flex w-[248px] shrink-0 flex-col border-r border-line bg-sidebar transition-transform md:static md:translate-x-0",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-3 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
            <IconMic size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-ink">
              {config.appName}
            </p>
            <p className="truncate text-[11px] leading-tight text-faint">{user?.email}</p>
          </div>
          <button
            className="rounded p-1 text-faint hover:bg-hover md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <IconX size={15} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "mb-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                  isActive ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink",
                )
              }
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* estado do motor */}
        <div className="border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <span
              className={cx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                !status
                  ? "bg-danger"
                  : status.processing
                    ? "bg-warning animate-pulse-soft"
                    : status.model_loaded
                      ? "bg-success"
                      : "bg-faint",
              )}
            />
            <span className="min-w-0 flex-1 truncate">
              {!status
                ? "backend offline"
                : status.processing
                  ? `gerando · fila ${status.queue_depth}`
                  : status.model_loaded
                    ? `${status.engine} pronto`
                    : `${status.engine} em espera`}
            </span>
          </div>
          {status?.gpu && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
              <IconChip size={12} />
              <span className="min-w-0 flex-1 truncate">
                {status.gpu.used_mb.toLocaleString("pt-BR")} / {status.gpu.total_mb.toLocaleString("pt-BR")} MB
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 border-t border-line px-2 py-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
            {initials}
          </div>
          <span className="min-w-0 flex-1 truncate px-1 text-[12px] text-muted">
            {user?.name || user?.email}
          </span>
          <button
            onClick={toggle}
            className="rounded p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          >
            {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
          </button>
          <button
            onClick={logout}
            className="rounded p-1.5 text-faint transition-colors hover:bg-hover hover:text-danger"
            title="Sair"
          >
            <IconLogout size={14} />
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------------- conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5 text-sm font-medium text-muted md:hidden"
          onClick={() => setMenuOpen(true)}
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[1.5px] w-4 bg-current" />
            <span className="block h-[1.5px] w-4 bg-current" />
            <span className="block h-[1.5px] w-4 bg-current" />
          </span>
          {config.appName}
        </button>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-10 md:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: string;
}) {
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-[28px] font-bold leading-tight tracking-tight text-ink">
            {icon && <span className="text-[26px] leading-none">{icon}</span>}
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
