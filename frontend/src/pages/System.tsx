import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Layout";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Divider, StatCard, cx } from "../components/ui";
import { IconBolt, IconChip, IconDatabase, IconRefresh } from "../components/icons";
import { api } from "../lib/api";
import { config } from "../lib/config";
import { formatBytes, formatMs } from "../lib/format";
import type { SystemStatus } from "../lib/types";

export function SystemPage() {
  const toast = useToast();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [busy, setBusy] = useState<"load" | "unload" | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (error) {
      setStatus(null);
      toast.error((error as Error).message);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function loadModel() {
    setBusy("load");
    try {
      await api.loadModel();
      toast.success("Modelo carregado na GPU");
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function unloadModel() {
    setBusy("unload");
    try {
      await api.unloadModel();
      toast.success("Modelo descarregado — a VRAM foi liberada");
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const gpuUsage = status?.gpu ? (status.gpu.used_mb / status.gpu.total_mb) * 100 : 0;

  return (
    <>
      <PageHeader
        icon="⚙️"
        title="Sistema"
        description="Estado do motor de síntese, da GPU e do cache. Tudo roda na sua máquina."
        actions={
          <Button icon={<IconRefresh size={14} />} onClick={() => void load()}>
            Atualizar
          </Button>
        }
      />

      {!status ? (
        <Card>
          <p className="text-[13px] text-danger">
            Backend indisponível em <code className="font-mono">{config.apiBase}</code>. Verifique
            se o container <code className="font-mono">vct-backend</code> está de pé.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Motor"
              value={status.engine}
              hint={status.model_loaded ? "modelo carregado" : "modelo não carregado"}
              icon={<IconBolt size={13} />}
              tone={status.model_loaded ? "success" : "warning"}
            />
            <StatCard
              label="Fila"
              value={`${status.queue_depth} / ${status.queue_max}`}
              hint={status.processing ? "gerando agora" : "ociosa"}
              icon={<IconChip size={13} />}
              tone={status.processing ? "warning" : "neutral"}
            />
            <StatCard
              label="Cache"
              value={formatBytes(status.cache.size_bytes)}
              hint={`${status.cache.entries.toLocaleString("pt-BR")} arquivos`}
              icon={<IconDatabase size={13} />}
              tone="accent"
            />
            <StatCard
              label="No ar há"
              value={formatMs(status.uptime_seconds * 1000)}
              hint={status.device}
              tone="purple"
            />
          </div>

          {/* ---------------------------------------------------------- modelo */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-ink">Modelo</h2>
                <p className="mt-0.5 break-all font-mono text-[12px] text-muted">{status.model}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={status.model_loaded ? "success" : "warning"}>
                    {status.model_loaded ? "carregado" : "em espera"}
                  </Badge>
                  <Badge>{status.device}</Badge>
                  {status.dtype && <Badge>{status.dtype}</Badge>}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  loading={busy === "load"}
                  disabled={status.model_loaded}
                  onClick={loadModel}
                >
                  Carregar
                </Button>
                <Button
                  variant="danger"
                  loading={busy === "unload"}
                  disabled={!status.model_loaded}
                  onClick={unloadModel}
                >
                  Descarregar
                </Button>
              </div>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-faint">
              Descarregar libera a VRAM para outros programas. O próximo request recarrega o
              modelo automaticamente (leva alguns segundos).
            </p>
          </Card>

          {/* ------------------------------------------------------------- GPU */}
          {status.gpu && (
            <Card>
              <h2 className="text-[14px] font-semibold text-ink">GPU</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {status.gpu.name} · compute {status.gpu.capability}
              </p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line-strong">
                <div
                  className={cx(
                    "h-full rounded-full transition-[width]",
                    gpuUsage > 90 ? "bg-danger" : gpuUsage > 70 ? "bg-warning" : "bg-success",
                  )}
                  style={{ width: `${Math.min(100, gpuUsage)}%` }}
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
                <Metric label="em uso" value={`${status.gpu.used_mb.toLocaleString("pt-BR")} MB`} />
                <Metric label="livre" value={`${status.gpu.free_mb.toLocaleString("pt-BR")} MB`} />
                <Metric
                  label="alocado (torch)"
                  value={`${status.gpu.allocated_mb.toLocaleString("pt-BR")} MB`}
                />
                <Metric
                  label="reservado"
                  value={`${status.gpu.reserved_mb.toLocaleString("pt-BR")} MB`}
                />
              </div>
            </Card>
          )}

          {/* ----------------------------------------------------------- infos */}
          <Card>
            <h2 className="text-[14px] font-semibold text-ink">Endereços</h2>
            <Divider />
            <dl className="space-y-2 text-[13px]">
              <Line label="API pública" value={config.publicApiUrl} />
              <Line label="Documentação da API" value={`${config.publicApiUrl}/docs`} link />
              <Line label="PocketBase (admin)" value={`${window.location.protocol}//${window.location.hostname}:8090/_/`} link />
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="font-mono tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function Line({ label, value, link }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-[12px]">
        {link ? (
          <a href={value} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {value}
          </a>
        ) : (
          <span className="text-ink">{value}</span>
        )}
      </dd>
    </div>
  );
}
