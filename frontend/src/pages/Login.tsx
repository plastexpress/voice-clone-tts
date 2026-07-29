import { useState } from "react";
import type { FormEvent } from "react";
import { IconMic } from "../components/icons";
import { Button, Field, Input } from "../components/ui";
import { config } from "../lib/config";
import { useAuth } from "../store/auth";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-[340px] animate-fade-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white">
            <IconMic size={22} />
          </div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">{config.appName}</h1>
          <p className="mt-1 text-[13px] text-faint">
            Entre para gerenciar tokens, clones de voz e testar a API.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          <Field label="E-mail" required>
            <Input
              type="email"
              autoComplete="username"
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field label="Senha" required>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] leading-snug text-danger">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" loading={loading} className="h-9 w-full">
            Entrar
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-faint">
          Usuários são gerenciados no PocketBase. O primeiro acesso usa as credenciais
          definidas em <code className="font-mono">PB_INITIAL_USER_*</code> no{" "}
          <code className="font-mono">deploy/.env</code>.
        </p>
      </div>
    </div>
  );
}
