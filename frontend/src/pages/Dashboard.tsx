import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/Layout";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  StatCard,
  Table,
  Td,
  Th,
  cx,
} from "../components/ui";
import {
  IconBolt,
  IconChip,
  IconDatabase,
  IconKey,
  IconMic,
  IconSparkles,
} from "../components/icons";
import { api } from "../lib/api";
import { formatBytes, formatMs, formatRelative, percent, truncate } from "../lib/format";
import { pb } from "../lib/pb";
import type { RequestLog, SystemStatus } from "../lib/types";

type Counts = {
  tokens: number;
  activeTokens: number;
  voices: number;
  requests24h: number;
  cached24h: number;
  errors24h: number;
};

export function Dashboard() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [recent, setRecent] = useState<RequestLog[]>([]);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);

      try {
        const [tokens, activeTokens, voices, requests, cached, errors, logs] = await Promise.all([
          pb.collection("api_tokens").getList(1, 1),
          pb.collection("api_tokens").getList(1, 1, { filter: "active = true" }),
          pb.collection("voices").getList(1, 1),
          pb.collection("request_logs").getList(1, 1, { filter: `created >= "${since}"` }),
          pb
            .collection("request_logs")
            .getList(1, 1, { filter: `created >= "${since}" && cached = true` }),
          pb
            .collection("request_logs")
            .getList(1, 1, { filter: `created >= "${since}" && status_code >= 400` }),
          pb.collection("request_logs").getList<RequestLog>(1, 8, { sort: "-created" }),
        ]);

        setCounts({
          tokens: tokens.totalItems,
          activeTokens: activeTokens.totalItems,
          voices: voices.totalItems,
          requests24h: requests.totalItems,
          cached24h: cached.totalItems,
          errors24h: errors.totalItems,
        });
        setRecent(logs.items);
      } catch {
        // sem dados ainda ou PocketBase fora do ar — os cards mostram "—"
      }

      try {
        setStatus(await api.status());
      } catch {
        setStatus(null);
      }
    })();
  }, []);

  return (
    <>
      <PageHeader
        icon="🏠"
        title="Visão geral"
        description="Serviço local de TTS com clonagem de voz. A API roda na 8096; esta interface, na 8095."
        actions={
          <Link to="/playground">
            <Button variant="primary" icon={<IconSparkles size={14} />}>
              Testar agora
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Requisições 24h"
          value={counts?.requests24h ?? "—"}
          hint={counts ? `${counts.errors24h} com erro` : undefined}
          icon={<IconBolt size={13} />}
          tone="accent"
        />
        <StatCard
          label="Cache hit"
          value={counts ? percent(counts.cached24h, counts.requests24h) : "—"}
          hint={counts ? `${counts.cached24h} de ${counts.requests24h} sem passar pela GPU` : undefined}
          icon={<IconDatabase size={13} />}
          tone="success"
        />
        <StatCard
          label="Tokens ativos"
          value={counts?.activeTokens ?? "—"}
          hint={counts ? `${counts.tokens} no total` : undefined}
          icon={<IconKey size={13} />}
          tone="purple"
        />
        <StatCard
          label="Clones de voz"
          value={counts?.voices ?? "—"}
          hint="disponíveis para os tokens"
          icon={<IconMic size={13} />}
          tone="warning"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* --------------------------------------------------- últimas chamadas */}
        <div className="min-w-0">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-ink">Últimas requisições</h2>
            <Link to="/logs" className="text-[12px] text-accent hover:underline">
              ver todas
            </Link>
          </div>

          {recent.length === 0 ? (
            <EmptyState
              title="Nenhuma requisição ainda"
              description="Assim que a API receber a primeira chamada, ela aparece aqui."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Texto</Th>
                  <Th>Token</Th>
                  <Th className="text-right">Tempo</Th>
                  <Th className="text-right">Quando</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((log) => (
                  <tr key={log.id}>
                    <Td className="max-w-[280px]">
                      <span className="block truncate text-[13px]">
                        {truncate(log.text_preview || "—", 60)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] text-muted">
                          {log.token_name || "—"}
                        </span>
                        {log.cached && <Badge tone="success">cache</Badge>}
                        {log.status_code >= 400 && <Badge tone="danger">{log.status_code}</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right font-mono text-[12px] tabular-nums text-muted">
                      {formatMs(log.duration_ms || 0)}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-[12px] text-faint">
                      {formatRelative(log.created)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        {/* ------------------------------------------------------------ status */}
        <div className="space-y-3">
          <Card>
            <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <IconChip size={14} /> Motor
            </p>
            {status ? (
              <dl className="space-y-1.5 text-[12px]">
                <Row label="engine" value={status.engine} />
                <Row label="modelo" value={status.model.split("/").pop() || status.model} mono />
                <Row
                  label="estado"
                  value={
                    <span
                      className={cx(
                        "font-medium",
                        status.model_loaded ? "text-success" : "text-warning",
                      )}
                    >
                      {status.model_loaded ? "carregado" : "não carregado"}
                    </span>
                  }
                />
                <Row label="fila" value={`${status.queue_depth} / ${status.queue_max}`} />
                {status.gpu && (
                  <>
                    <Row label="gpu" value={status.gpu.name} />
                    <Row
                      label="vram"
                      value={`${status.gpu.used_mb.toLocaleString("pt-BR")} / ${status.gpu.total_mb.toLocaleString("pt-BR")} MB`}
                    />
                  </>
                )}
              </dl>
            ) : (
              <p className="text-[12px] text-danger">backend indisponível</p>
            )}
          </Card>

          <Card>
            <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <IconDatabase size={14} /> Cache local
            </p>
            {status ? (
              <dl className="space-y-1.5 text-[12px]">
                <Row label="arquivos" value={status.cache.entries.toLocaleString("pt-BR")} />
                <Row label="tamanho" value={formatBytes(status.cache.size_bytes)} />
                <Row label="áudio" value={`${status.cache.audio_hours} h`} />
                <Row label="limite" value={`${status.cache.limit_gb} GB`} />
              </dl>
            ) : (
              <p className="text-[12px] text-faint">—</p>
            )}
            <Link to="/cache">
              <Button size="sm" className="mt-3 w-full">
                Abrir cache
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className={cx("min-w-0 truncate text-right text-ink", mono && "font-mono text-[11px]")}>
        {value}
      </dd>
    </div>
  );
}
