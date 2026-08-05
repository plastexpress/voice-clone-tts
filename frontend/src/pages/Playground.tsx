import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/Layout";
import { AudioPlayer } from "../components/AudioPlayer";
import { CodeBlock } from "../components/CodeBlock";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "../components/ui";
import { IconBolt, IconSparkles } from "../components/icons";
import { api, ApiError, type JobStatus } from "../lib/api";
import { config } from "../lib/config";
import { formatBytes, formatDuration, formatMs } from "../lib/format";
import { pb, pbError } from "../lib/pb";
import { recallToken } from "../lib/token";
import type { ApiToken, GenerationResult, Voice } from "../lib/types";

const SAMPLE = "Oi! Esse é um teste de geração de voz rodando localmente na minha GPU.";

type PlaygroundParams = {
  voice: string;
  language: string;
  format: "" | "opus" | "wav";
  bitrate: string;
  channels: "" | "1" | "2";
  temperature: string;
  topP: string;
  topK: string;
  repetitionPenalty: string;
  speechRate: string;
  seed: string;
  instruction: string;
};

const EMPTY_PARAMS: PlaygroundParams = {
  voice: "",
  language: "",
  format: "",
  bitrate: "",
  channels: "",
  temperature: "",
  topP: "",
  topK: "",
  repetitionPenalty: "",
  speechRate: "",
  seed: "",
  instruction: "",
};

export function Playground() {
  const toast = useToast();

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [text, setText] = useState(SAMPLE);
  const [params, setParams] = useState<PlaygroundParams>(EMPTY_PARAMS);
  const [useCache, setUseCache] = useState(true);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<JobStatus | null>(null);

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
    if (params.voice) payload.voice = params.voice;
    if (params.language) payload.language = params.language;
    if (params.format) payload.format = params.format;
    if (params.bitrate) payload.bitrate = params.bitrate;
    if (params.channels) payload.channels = Number(params.channels);
    if (params.temperature) payload.temperature = Number(params.temperature);
    if (params.topP) payload.top_p = Number(params.topP);
    if (params.topK) payload.top_k = Number(params.topK);
    if (params.repetitionPenalty) payload.repetition_penalty = Number(params.repetitionPenalty);
    if (params.speechRate) payload.speech_rate = Number(params.speechRate);
    if (params.seed) payload.seed = Number(params.seed);
    if (params.instruction) payload.instruction = params.instruction;
    if (!useCache) payload.cache = false;
    return payload;
  }, [text, params, useCache]);

  const generate = useCallback(async () => {
    if (!text.trim()) {
      toast.error("Escreva o texto que deve ser falado");
      return;
    }

    setGenerating(true);
    setResult(null);
    setProgress(null);
    try {
      // sempre via sessão logada: pode trocar voz/parâmetros livremente aqui,
      // sem depender de allow_overrides em nenhum token de API.
      const generated = await api.generatePlaygroundAsync(body, setProgress);
      setResult({ ...generated, voice: params.voice });
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
      setProgress(null);
    }
  }, [text, body, toast, params]);

  const tokenForExample = rawToken || "SEU_TOKEN";
  const jsonBody = JSON.stringify(body);

  return (
    <>
      <PageHeader
        icon="✨"
        title="Playground"
        description="Escolha qualquer voz clonada e ajuste os parâmetros livremente com sua sessão — os exemplos abaixo mostram como reproduzir isso com um token real de API."
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

              <div className="flex items-center gap-2.5">
                {generating && (
                  <span className="text-[12px] text-faint">{progressLabel(progress)}</span>
                )}
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
                  voz <span className="font-mono text-muted">{result.voice}</span>
                </p>
              )}
            </Card>
          )}

          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold text-ink">Como chamar de fora</h2>
            <p className="text-[12px] text-faint">
              O corpo abaixo reflete a voz e os parâmetros escolhidos ao lado. Pra reproduzir com
              um cliente real, use um token com <code className="font-mono">allow_overrides</code>{" "}
              ligado (só assim a API aceita esses campos extras vindos de fora). Fluxo assíncrono
              (job + polling): a resposta síncrona pode passar de 100s numa geração mais longa e
              proxies/túneis na frente da API costumam derrubar a conexão antes disso.
            </p>
            <CodeBlock
              label="curl"
              code={`# 1) enfileira e pega o job_id na hora (202)
JOB=$(curl -s -X POST ${config.publicApiUrl}/v1/tts/async \\
  -H "Authorization: Bearer ${tokenForExample}" \\
  -H "Content-Type: application/json" \\
  -d '${jsonBody}')
JOB_ID=$(echo "$JOB" | python3 -c "import json,sys;print(json.load(sys.stdin)['job_id'])")

# 2) consulta até terminar
while true; do
  STATUS=$(curl -s ${config.publicApiUrl}/v1/jobs/$JOB_ID \\
    -H "Authorization: Bearer ${tokenForExample}")
  echo "$STATUS"
  case "$STATUS" in *'"status":"completed"'*|*'"status":"failed"'*) break ;; esac
  sleep 1.5
done

# 3) baixa o áudio pelo audio_id retornado
AUDIO_ID=$(echo "$STATUS" | python3 -c "import json,sys;print(json.load(sys.stdin)['audio_id'])")
curl -s ${config.publicApiUrl}/v1/audio/$AUDIO_ID \\
  -H "Authorization: Bearer ${tokenForExample}" \\
  --output fala.opus`}
            />
            <CodeBlock
              label="python"
              code={`import time
import requests

API = "${config.publicApiUrl}"
HEADERS = {"Authorization": "Bearer ${tokenForExample}"}

job = requests.post(f"{API}/v1/tts/async", headers=HEADERS, json=${toPython(body)}, timeout=15)
job.raise_for_status()
job_id = job.json()["job_id"]

while True:
    status = requests.get(f"{API}/v1/jobs/{job_id}", headers=HEADERS, timeout=15).json()
    if status["status"] in ("completed", "failed", "canceled"):
        break
    time.sleep(1.5)

if status["status"] != "completed":
    raise RuntimeError(status.get("error") or status["status"])

audio = requests.get(f"{API}/v1/audio/{status['audio_id']}", headers=HEADERS, timeout=60)
open("fala.opus", "wb").write(audio.content)
print("duração:", status["duration_ms"], "ms")`}
            />
            <CodeBlock
              label="javascript"
              code={`const API = "${config.publicApiUrl}";
const headers = { Authorization: "Bearer ${tokenForExample}" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const submitted = await fetch(\`\${API}/v1/tts/async\`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(${jsonBody}),
});
const { job_id } = await submitted.json();

let status;
do {
  await sleep(1500);
  status = await (await fetch(\`\${API}/v1/jobs/\${job_id}\`, { headers })).json();
} while (!["completed", "failed", "canceled"].includes(status.status));

if (status.status !== "completed") throw new Error(status.error || status.status);

const audioRes = await fetch(\`\${API}/v1/audio/\${status.audio_id}\`, { headers });
const audio = new Audio(URL.createObjectURL(await audioRes.blob()));
audio.play();`}
            />
          </div>
        </div>

        {/* ------------------------------------------------------- coluna 2 */}
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3.5">
            <div>
              <p className="text-[13px] font-semibold text-ink">Voz &amp; parâmetros</p>
              <p className="mt-0.5 text-xs leading-relaxed text-faint">
                Testes aqui usam sua sessão logada, não um token — pode trocar de voz e ajustar
                tudo livremente. Deixe em branco pra cair no padrão do serviço.
              </p>
            </div>

            <Field label="Voz">
              <Select
                value={params.voice}
                onChange={(event) => setParams({ ...params, voice: event.target.value })}
              >
                <option value="">padrão do motor (sem clone)</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.slug}>
                    {voice.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Idioma">
                <Input
                  value={params.language}
                  onChange={(event) => setParams({ ...params, language: event.target.value })}
                  placeholder="Portuguese"
                />
              </Field>
              <Field label="Velocidade da fala" hint="1.0 = normal">
                <Input
                  type="number"
                  step="0.05"
                  min="0.4"
                  max="2.5"
                  value={params.speechRate}
                  onChange={(event) => setParams({ ...params, speechRate: event.target.value })}
                  placeholder="1.0"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperature">
                <Input
                  type="number"
                  step="0.05"
                  value={params.temperature}
                  onChange={(event) => setParams({ ...params, temperature: event.target.value })}
                  placeholder="1.7"
                />
              </Field>
              <Field label="Top P">
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={params.topP}
                  onChange={(event) => setParams({ ...params, topP: event.target.value })}
                  placeholder="0.8"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Top K">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="500"
                  value={params.topK}
                  onChange={(event) => setParams({ ...params, topK: event.target.value })}
                  placeholder="25"
                />
              </Field>
              <Field label="Repetition penalty">
                <Input
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="3"
                  value={params.repetitionPenalty}
                  onChange={(event) =>
                    setParams({ ...params, repetitionPenalty: event.target.value })
                  }
                  placeholder="1.0"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Formato">
                <Select
                  value={params.format}
                  onChange={(event) =>
                    setParams({ ...params, format: event.target.value as PlaygroundParams["format"] })
                  }
                >
                  <option value="">opus (padrão)</option>
                  <option value="opus">opus</option>
                  <option value="wav">wav</option>
                </Select>
              </Field>
              <Field label="Canais">
                <Select
                  value={params.channels}
                  onChange={(event) =>
                    setParams({
                      ...params,
                      channels: event.target.value as PlaygroundParams["channels"],
                    })
                  }
                >
                  <option value="">mono (padrão)</option>
                  <option value="1">1 (mono)</option>
                  <option value="2">2 (estéreo)</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Bitrate" hint='ex.: "64k"'>
                <Input
                  value={params.bitrate}
                  onChange={(event) => setParams({ ...params, bitrate: event.target.value })}
                  placeholder="64k"
                />
              </Field>
              <Field label="Seed" hint="reprodutibilidade">
                <Input
                  type="number"
                  min="0"
                  value={params.seed}
                  onChange={(event) => setParams({ ...params, seed: event.target.value })}
                  placeholder="aleatório"
                />
              </Field>
            </div>

            <Field
              label="Instrução (experimental)"
              hint="Separado do texto — sotaque, emoção, entonação. Ex.: 'fale com sotaque americano'."
            >
              <Textarea
                rows={2}
                value={params.instruction}
                onChange={(event) => setParams({ ...params, instruction: event.target.value })}
                placeholder="fale com sotaque americano"
              />
            </Field>
          </Card>

          <Card className="space-y-3">
            <Field label="Token" hint="Usado só nos exemplos de código ao lado, não na geração acima.">
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
                    overrides de clientes externos:{" "}
                    <span className={selected.allow_overrides ? "text-success" : "text-faint"}>
                      {selected.allow_overrides ? "permitidos" : "bloqueados"}
                    </span>
                  </li>
                </ul>
              </div>
            )}
          </Card>

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

function progressLabel(job: JobStatus | null): string {
  if (!job) return "enviando…";
  switch (job.status) {
    case "queued":
      return "na fila…";
    case "processing":
      return "gerando na GPU…";
    default:
      return job.status;
  }
}

function toPython(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 4)
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
}
