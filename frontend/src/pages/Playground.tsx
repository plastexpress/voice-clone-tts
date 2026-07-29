import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/Layout";
import { AudioPlayer } from "../components/AudioPlayer";
import { CodeBlock } from "../components/CodeBlock";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "../components/ui";
import { IconBolt, IconSparkles } from "../components/icons";
import { api, ApiError } from "../lib/api";
import { config } from "../lib/config";
import { formatBytes, formatDuration, formatMs } from "../lib/format";
import { pb, pbError } from "../lib/pb";
import { recallToken } from "../lib/token";
import type { ApiToken, GenerationResult, Voice } from "../lib/types";

const SAMPLE = "Oi! Esse é um teste de geração de voz rodando localmente na minha GPU.";

export function Playground() {
  const toast = useToast();

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [text, setText] = useState(SAMPLE);
  const [overrides, setOverrides] = useState({ enabled: false, voice: "", language: "", temperature: "" });
  const [useCache, setUseCache] = useState(true);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [tokenList, voiceList] = await Promise.all([
          pb.collection("api_tokens").getFullList<ApiToken>({ sort: "-created", expand: "voice" }),
          pb.collection("voices").getFullList<Voice>({ sort: "name", filter: "active = true" }),
        ]);
        setTokens(tokenList);
        setVoices(voiceList);
        const firstLocal = tokenList.find((token) => token.active && recallToken(token.id));
        if (firstLocal) setSelectedId(firstLocal.id);
      } catch (error) {
        toast.error(pbError(error, "Não consegui carregar os tokens"));
      }
    })();
  }, [toast]);

  const selected = useMemo(
    () => tokens.find((token) => token.id === selectedId) ?? null,
    [tokens, selectedId],
  );

  const rawToken = useMemo(() => {
    if (manualToken.trim()) return manualToken.trim();
    return selectedId ? recallToken(selectedId) ?? "" : "";
  }, [manualToken, selectedId]);

  const body = useMemo(() => {
    const payload: Record<string, unknown> = { text };
    if (overrides.enabled && selected?.allow_overrides) {
      if (overrides.voice) payload.voice = overrides.voice;
      if (overrides.language) payload.language = overrides.language;
      if (overrides.temperature) payload.temperature = Number(overrides.temperature);
    }
    if (!useCache) payload.cache = false;
    return payload;
  }, [text, overrides, selected, useCache]);

  const generate = useCallback(async () => {
    if (!rawToken) {
      toast.error("Escolha um token ou cole um valor válido");
      return;
    }
    if (!text.trim()) {
      toast.error("Escreva o texto que deve ser falado");
      return;
    }

    setGenerating(true);
    setResult(null);
    try {
      const generated = await api.generate(rawToken, body);
      setResult(generated);
      toast.success(
        generated.cached
          ? "Servido do cache local — sem passar pela GPU"
          : `Gerado em ${formatMs(generated.generationMs || generated.totalMs)}`,
      );
    } catch (error) {
      const message =
        error instanceof ApiError ? `${error.status}: ${error.message}` : (error as Error).message;
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }, [rawToken, text, body, toast]);

  const tokenForExample = rawToken || "SEU_TOKEN";
  const jsonBody = JSON.stringify(body);

  return (
    <>
      <PageHeader
        icon="✨"
        title="Playground"
        description="Testa a API de verdade: mesma rota, mesmo token e mesmas regras de cache que seus clientes usam."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ------------------------------------------------------- coluna 1 */}
        {/* min-w-0: sem isso os <pre> dos exemplos esticam a coluna do grid */}
        <div className="min-w-0 space-y-4">
          <Card className="space-y-4">
            <Field
              label="Texto"
              hint={`${text.length} caracteres — textos idênticos com a mesma voz vêm do cache.`}
            >
              <Textarea
                rows={7}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Escreva o que a voz deve falar…"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate();
                }}
              />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={useCache}
                  onChange={(event) => setUseCache(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Usar cache
              </label>

              <Button
                variant="primary"
                loading={generating}
                onClick={generate}
                icon={<IconSparkles size={14} />}
                className="h-9 px-4"
              >
                {generating ? "Gerando…" : "Gerar áudio"}
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="animate-fade-in space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {result.cached ? (
                  <Badge tone="success">
                    <IconBolt size={11} /> cache hit
                  </Badge>
                ) : (
                  <Badge tone="accent">gerado agora</Badge>
                )}
                <Badge>{formatDuration(result.durationMs)} de áudio</Badge>
                <Badge>{formatBytes(result.sizeBytes)}</Badge>
                {!!result.queueMs && <Badge>fila {formatMs(result.queueMs)}</Badge>}
                {!!result.generationMs && <Badge>síntese {formatMs(result.generationMs)}</Badge>}
                <Badge tone="neutral">total {formatMs(result.totalMs)}</Badge>
              </div>

              <AudioPlayer src={result.url} filename={`playground-${result.audioId || "audio"}.opus`} />

              {result.voice && (
                <p className="text-[12px] text-faint">
                  voz <span className="font-mono text-muted">{result.voice}</span> · modelo{" "}
                  <span className="font-mono text-muted">{result.model}</span>
                </p>
              )}
            </Card>
          )}

          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold text-ink">Como chamar de fora</h2>
            <CodeBlock
              label="curl"
              code={`curl -X POST ${config.publicApiUrl}/v1/tts \\
  -H "Authorization: Bearer ${tokenForExample}" \\
  -H "Content-Type: application/json" \\
  -d '${jsonBody}' \\
  --output fala.opus`}
            />
            <CodeBlock
              label="python"
              code={`import requests

response = requests.post(
    "${config.publicApiUrl}/v1/tts",
    headers={"Authorization": "Bearer ${tokenForExample}"},
    json=${toPython(body)},
    timeout=300,
)
response.raise_for_status()
open("fala.opus", "wb").write(response.content)
print("cache:", response.headers.get("X-Cache"))`}
            />
            <CodeBlock
              label="javascript"
              code={`const response = await fetch("${config.publicApiUrl}/v1/tts", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${tokenForExample}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${jsonBody}),
});

const blob = await response.blob();
const audio = new Audio(URL.createObjectURL(blob));
audio.play();`}
            />
          </div>
        </div>

        {/* ------------------------------------------------------- coluna 2 */}
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3.5">
            <Field label="Token" hint="Só aparecem os tokens cujo valor está salvo neste navegador.">
              <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">— escolha um token —</option>
                {tokens.map((token) => {
                  const available = !!recallToken(token.id);
                  return (
                    <option key={token.id} value={token.id} disabled={!available || !token.active}>
                      {token.name}
                      {!token.active ? " (inativo)" : available ? "" : " (valor não salvo aqui)"}
                    </option>
                  );
                })}
              </Select>
            </Field>

            <Field label="ou cole um token" hint="Útil se o token foi criado em outro navegador.">
              <Input
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="vct_…"
                className="font-mono text-[12px]"
              />
            </Field>

            {selected && (
              <div className="rounded-md border border-line bg-subtle p-3 text-[12px] leading-relaxed text-muted">
                <p className="mb-1 font-medium text-ink">Configuração deste token</p>
                <ul className="space-y-0.5">
                  <li>
                    voz:{" "}
                    <span className="text-ink">
                      {selected.expand?.voice?.name || "padrão do modelo"}
                    </span>
                  </li>
                  <li>
                    idioma: <span className="text-ink">{selected.settings?.language || "—"}</span>
                  </li>
                  <li>
                    formato:{" "}
                    <span className="text-ink">
                      {selected.settings?.format || "opus"} · {selected.settings?.bitrate || "64k"}
                    </span>
                  </li>
                  <li>
                    overrides:{" "}
                    <span className={cx(selected.allow_overrides ? "text-success" : "text-faint")}>
                      {selected.allow_overrides ? "permitidos" : "bloqueados"}
                    </span>
                  </li>
                </ul>
              </div>
            )}
          </Card>

          {selected?.allow_overrides && (
            <Card className="space-y-3">
              <Toggle
                checked={overrides.enabled}
                onChange={(value) => setOverrides({ ...overrides, enabled: value })}
                label="Sobrescrever no request"
                hint="Manda os campos junto do texto, como um cliente faria."
              />

              {overrides.enabled && (
                <div className="space-y-3">
                  <Field label="Voz">
                    <Select
                      value={overrides.voice}
                      onChange={(event) => setOverrides({ ...overrides, voice: event.target.value })}
                    >
                      <option value="">usar a do token</option>
                      {voices.map((voice) => (
                        <option key={voice.id} value={voice.slug}>
                          {voice.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Idioma">
                    <Input
                      value={overrides.language}
                      onChange={(event) =>
                        setOverrides({ ...overrides, language: event.target.value })
                      }
                      placeholder="Portuguese"
                    />
                  </Field>

                  <Field label="Temperature">
                    <Input
                      type="number"
                      step="0.05"
                      value={overrides.temperature}
                      onChange={(event) =>
                        setOverrides({ ...overrides, temperature: event.target.value })
                      }
                      placeholder="1.7"
                    />
                  </Field>
                </div>
              )}
            </Card>
          )}

          <Card>
            <p className="mb-1.5 text-[13px] font-medium text-ink">Corpo enviado</p>
            <pre className="overflow-x-auto rounded-md bg-subtle p-2.5 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(body, null, 2)}
            </pre>
          </Card>
        </div>
      </div>
    </>
  );
}

function toPython(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 4)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
}
