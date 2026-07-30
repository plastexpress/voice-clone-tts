import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/Layout";
import { ConfirmDialog, Modal } from "../components/Modal";
import { CodeBlock } from "../components/CodeBlock";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  CopyButton,
  Divider,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  Toggle,
  cx,
} from "../components/ui";
import { IconEye, IconKey, IconPlus, IconTrash } from "../components/icons";
import { api, ApiError } from "../lib/api";
import { config } from "../lib/config";
import { formatRelative } from "../lib/format";
import { pb, pbError } from "../lib/pb";
import { displayPrefix, forgetToken, generateToken, hashToken, recallToken, rememberToken } from "../lib/token";
import type { ApiToken, TokenSettings, Voice } from "../lib/types";
import { useAuth } from "../store/auth";

const DEFAULT_SETTINGS: TokenSettings = {
  language: "Portuguese",
  temperature: 1.7,
  top_p: 0.8,
  top_k: 25,
  repetition_penalty: 1.0,
  max_new_tokens: 4096,
  speech_rate: 1.0,
  format: "opus",
  bitrate: "64k",
  channels: 1,
};

const LANGUAGES = [
  "Portuguese",
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Chinese",
  "Russian",
  "Arabic",
  "Turkish",
];

type FormState = {
  name: string;
  voice: string;
  allow_overrides: boolean;
  rate_limit_per_min: string;
  expires_at: string;
  settings: TokenSettings;
};

const EMPTY_FORM: FormState = {
  name: "",
  voice: "",
  allow_overrides: false,
  rate_limit_per_min: "0",
  expires_at: "",
  settings: { ...DEFAULT_SETTINGS },
};

export function Tokens() {
  const { user } = useAuth();
  const toast = useToast();

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiToken | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [created, setCreated] = useState<{ raw: string; name: string } | null>(null);
  const [revealed, setRevealed] = useState<{ raw: string; name: string } | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ApiToken | null>(null);

  const load = useCallback(async () => {
    try {
      const [tokenList, voiceList] = await Promise.all([
        pb.collection("api_tokens").getFullList<ApiToken>({ sort: "-created", expand: "voice" }),
        pb.collection("voices").getFullList<Voice>({ sort: "name" }),
      ]);
      setTokens(tokenList);
      setVoices(voiceList);
    } catch (error) {
      toast.error(pbError(error, "Não consegui carregar os tokens"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, settings: { ...DEFAULT_SETTINGS } });
    setFormOpen(true);
  }

  function openEdit(token: ApiToken) {
    setEditing(token);
    setForm({
      name: token.name,
      voice: token.voice || "",
      allow_overrides: !!token.allow_overrides,
      rate_limit_per_min: String(token.rate_limit_per_min ?? 0),
      expires_at: token.expires_at ? token.expires_at.slice(0, 10) : "",
      settings: { ...DEFAULT_SETTINGS, ...(token.settings || {}) },
    });
    setFormOpen(true);
  }

  async function save() {
    if (!user) return;
    if (!form.name.trim()) {
      toast.error("Dê um nome ao token");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        voice: form.voice || "",
        settings: form.settings,
        allow_overrides: form.allow_overrides,
        rate_limit_per_min: Number(form.rate_limit_per_min) || 0,
        expires_at: form.expires_at ? `${form.expires_at} 23:59:59.000Z` : "",
      };

      if (editing) {
        await pb.collection("api_tokens").update(editing.id, payload);
        toast.success("Token atualizado");
      } else {
        const raw = generateToken();

        // guarda também cifrado (reversível) pra poder "revelar" depois pela
        // interface — se a chave não estiver configurada no backend, segue
        // sem esse campo (o token funciona normalmente, só não dá pra revelar).
        let tokenEncrypted = "";
        try {
          tokenEncrypted = (await api.encryptToken(raw)).encrypted;
        } catch (error) {
          toast.error(
            error instanceof ApiError
              ? `Token criado, mas sem valor recuperável: ${error.message}`
              : "Token criado, mas não consegui salvar o valor recuperável",
          );
        }

        const record = await pb.collection("api_tokens").create<ApiToken>({
          ...payload,
          token_hash: await hashToken(raw),
          token_prefix: displayPrefix(raw),
          token_encrypted: tokenEncrypted,
          owner: user.id,
          active: true,
          request_count: 0,
          cached_count: 0,
        });
        rememberToken(record.id, raw);
        setCreated({ raw, name: payload.name });
      }

      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui salvar o token"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(token: ApiToken) {
    try {
      await pb.collection("api_tokens").update(token.id, { active: !token.active });
      setTokens((current) =>
        current.map((item) => (item.id === token.id ? { ...item, active: !item.active } : item)),
      );
    } catch (error) {
      toast.error(pbError(error, "Não consegui alterar o token"));
    }
  }

  async function reveal(token: ApiToken) {
    setRevealingId(token.id);
    try {
      const { token: raw } = await api.revealToken(token.id);
      rememberToken(token.id, raw);
      setRevealed({ raw, name: token.name });
    } catch (error) {
      toast.error(
        error instanceof ApiError ? `${error.status}: ${error.message}` : (error as Error).message,
      );
    } finally {
      setRevealingId(null);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await pb.collection("api_tokens").delete(removing.id);
      forgetToken(removing.id);
      toast.success("Token revogado");
      setRemoving(null);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui revogar o token"));
    }
  }

  return (
    <>
      <PageHeader
        icon="🔑"
        title="Tokens"
        description="Cada token carrega um clone de voz e um conjunto de parâmetros. Quem consome a API só precisa mandar o texto."
        actions={
          <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
            Novo token
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-faint">Carregando…</p>
      ) : tokens.length === 0 ? (
        <EmptyState
          icon={<IconKey size={26} />}
          title="Nenhum token ainda"
          description="Crie um token para liberar o acesso à API. O valor em claro aparece uma única vez."
          action={
            <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
              Criar o primeiro token
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Token</Th>
              <Th>Clone de voz</Th>
              <Th className="text-right">Requisições</Th>
              <Th>Último uso</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => {
              const expired = token.expires_at && new Date(token.expires_at.replace(" ", "T")) < new Date();
              return (
                <tr key={token.id} className="group transition-colors hover:bg-hover/60">
                  <Td>
                    <button
                      onClick={() => openEdit(token)}
                      className="block max-w-[260px] text-left"
                    >
                      <span className="block truncate text-[13px] font-medium text-ink hover:underline">
                        {token.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {token.token_prefix}…
                      </span>
                    </button>
                  </Td>
                  <Td>
                    {token.expand?.voice ? (
                      <Badge tone="purple">{token.expand.voice.name}</Badge>
                    ) : (
                      <span className="text-[13px] text-faint">sem clone</span>
                    )}
                  </Td>
                  <Td className="text-right font-mono text-[13px] tabular-nums">
                    {token.request_count ?? 0}
                    {!!token.cached_count && (
                      <span className="ml-1.5 text-[11px] text-faint">
                        ({token.cached_count} cache)
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-[13px] text-muted">
                    {formatRelative(token.last_used_at)}
                  </Td>
                  <Td className="w-px whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {expired ? (
                        <Badge tone="warning">expirado</Badge>
                      ) : (
                        <button
                          onClick={() => toggleActive(token)}
                          className={cx(
                            "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                            token.active
                              ? "bg-success-soft text-success hover:opacity-80"
                              : "bg-hover text-faint hover:text-ink",
                          )}
                          title={token.active ? "Desativar" : "Ativar"}
                        >
                          {token.active ? "ativo" : "inativo"}
                        </button>
                      )}
                      <button
                        onClick={() => reveal(token)}
                        disabled={revealingId === token.id}
                        className="rounded p-1 text-faint opacity-0 transition-all hover:bg-hover hover:text-ink group-hover:opacity-100 disabled:opacity-100"
                        title="Revelar valor"
                      >
                        <IconEye size={14} />
                      </button>
                      <button
                        onClick={() => setRemoving(token)}
                        className="rounded p-1 text-faint opacity-0 transition-all hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                        title="Revogar"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* ------------------------------------------------------ criar/editar */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar token" : "Novo token"}
        description={
          editing
            ? "As mudanças valem para as próximas requisições (o cache do backend leva até 20s para atualizar)."
            : "O valor em claro é mostrado uma única vez, logo depois de criar."
        }
        footer={
          <>
            <Button onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Salvar" : "Criar token"}
            </Button>
          </>
        }
      >
        <TokenForm form={form} setForm={setForm} voices={voices} />
      </Modal>

      {/* ------------------------------------------------- token recém-criado */}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Token criado"
        description="Dá pra ver este valor de novo depois, clicando no ícone de olho na lista."
        footer={<Button variant="primary" onClick={() => setCreated(null)}>Entendi</Button>}
      >
        {created && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
                {created.raw}
              </code>
              <CopyButton value={created.raw} />
            </div>

            <Divider label="como usar" />

            <CodeBlock
              label="curl"
              code={`curl -X POST ${config.publicApiUrl}/v1/tts \\
  -H "Authorization: Bearer ${created.raw}" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Olá, esse é um teste de voz."}' \\
  --output fala.opus`}
            />
          </div>
        )}
      </Modal>

      {/* ---------------------------------------------------- token revelado */}
      <Modal
        open={!!revealed}
        onClose={() => setRevealed(null)}
        title={`Token de "${revealed?.name ?? ""}"`}
        description="Valor original, decifrado agora pelo backend."
        footer={<Button variant="primary" onClick={() => setRevealed(null)}>Fechar</Button>}
      >
        {revealed && (
          <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">
              {revealed.raw}
            </code>
            <CopyButton value={revealed.raw} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Revogar token"
        confirmLabel="Revogar"
        message={
          <>
            Quem estiver usando <strong className="text-ink">{removing?.name}</strong> perde o
            acesso imediatamente. Essa ação não pode ser desfeita.
          </>
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function TokenForm({
  form,
  setForm,
  voices,
}: {
  form: FormState;
  setForm: (value: FormState) => void;
  voices: Voice[];
}) {
  const [advanced, setAdvanced] = useState(false);

  const setSetting = <K extends keyof TokenSettings>(key: K, value: TokenSettings[K]) =>
    setForm({ ...form, settings: { ...form.settings, [key]: value } });

  return (
    <div className="space-y-4">
      <Field label="Nome" required hint="Só para você identificar quem usa este token.">
        <Input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Ex.: integração do site"
        />
      </Field>

      <Field
        label="Clone de voz"
        hint="A voz aplicada automaticamente em toda requisição deste token."
      >
        <Select
          value={form.voice}
          onChange={(event) => setForm({ ...form, voice: event.target.value })}
        >
          <option value="">Sem clone (voz padrão do modelo)</option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Idioma">
          <Select
            value={form.settings.language || "Portuguese"}
            onChange={(event) => setSetting("language", event.target.value)}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Bitrate do Opus">
          <Select
            value={form.settings.bitrate || "64k"}
            onChange={(event) => setSetting("bitrate", event.target.value)}
          >
            <option value="32k">32 kbps — voz econômica</option>
            <option value="48k">48 kbps</option>
            <option value="64k">64 kbps — recomendado</option>
            <option value="96k">96 kbps</option>
            <option value="128k">128 kbps — alta fidelidade</option>
          </Select>
        </Field>
      </div>

      <Toggle
        checked={form.allow_overrides}
        onChange={(value) => setForm({ ...form, allow_overrides: value })}
        label="Permitir sobrescrever parâmetros no request"
        hint="Se ligado, o cliente pode mandar voice, language, temperature etc. no corpo da chamada."
      />

      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        className="text-[12px] font-medium text-accent hover:underline"
      >
        {advanced ? "Ocultar" : "Mostrar"} opções avançadas
      </button>

      {advanced && (
        <div className="space-y-4 rounded-md border border-line bg-subtle p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Temperature" hint="Padrão do modelo: 1.7">
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="3"
                value={form.settings.temperature ?? 1.7}
                onChange={(event) => setSetting("temperature", Number(event.target.value))}
              />
            </Field>
            <Field label="Top-p" hint="Padrão: 0.8">
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                value={form.settings.top_p ?? 0.8}
                onChange={(event) => setSetting("top_p", Number(event.target.value))}
              />
            </Field>
            <Field label="Top-k" hint="Padrão: 25">
              <Input
                type="number"
                step="1"
                min="0"
                value={form.settings.top_k ?? 25}
                onChange={(event) => setSetting("top_k", Number(event.target.value))}
              />
            </Field>
            <Field label="Repetition penalty" hint="Padrão: 1.0">
              <Input
                type="number"
                step="0.05"
                min="0.5"
                max="3"
                value={form.settings.repetition_penalty ?? 1.0}
                onChange={(event) => setSetting("repetition_penalty", Number(event.target.value))}
              />
            </Field>
            <Field
              label="Velocidade da fala"
              hint="1.0 = normal, 1.3 = ~30% mais rápido, 0.7 = ~30% mais devagar"
            >
              <Input
                type="number"
                step="0.05"
                min="0.4"
                max="2.5"
                value={form.settings.speech_rate ?? 1.0}
                onChange={(event) => setSetting("speech_rate", Number(event.target.value))}
              />
            </Field>
            <Field
              label="Instrução (experimental)"
              hint="Sotaque, emoção, entonação — separado do texto. Ex.: 'fale com sotaque americano'."
            >
              <Input
                value={form.settings.instruction ?? ""}
                onChange={(event) => setSetting("instruction", event.target.value)}
                placeholder="fale com sotaque americano"
              />
            </Field>
            <Field label="Máximo de tokens de áudio" hint="1 s de fala ≈ 12,5 tokens">
              <Input
                type="number"
                step="128"
                min="128"
                value={form.settings.max_new_tokens ?? 4096}
                onChange={(event) => setSetting("max_new_tokens", Number(event.target.value))}
              />
            </Field>
            <Field label="Canais">
              <Select
                value={String(form.settings.channels ?? 1)}
                onChange={(event) => setSetting("channels", Number(event.target.value))}
              >
                <option value="1">Mono</option>
                <option value="2">Estéreo</option>
              </Select>
            </Field>
            <Field label="Limite por minuto" hint="0 = sem limite">
              <Input
                type="number"
                min="0"
                value={form.rate_limit_per_min}
                onChange={(event) => setForm({ ...form, rate_limit_per_min: event.target.value })}
              />
            </Field>
            <Field label="Expira em" hint="Deixe vazio para não expirar">
              <Input
                type="date"
                value={form.expires_at}
                onChange={(event) => setForm({ ...form, expires_at: event.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

/** Usado pelo Playground: tokens cujo valor em claro está salvo neste navegador. */
export function useLocalTokens(tokens: ApiToken[]) {
  return useMemo(
    () =>
      tokens
        .filter((token) => token.active)
        .map((token) => ({ token, raw: recallToken(token.id) }))
        .filter((item): item is { token: ApiToken; raw: string } => !!item.raw),
    [tokens],
  );
}
