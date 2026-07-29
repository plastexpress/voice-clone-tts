import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Layout";
import { useToast } from "../components/Toast";
import { Badge, Button, EmptyState, Select, Table, Td, Th, Toggle, cx } from "../components/ui";
import { IconList, IconRefresh } from "../components/icons";
import { formatDate, formatMs, truncate } from "../lib/format";
import { pb, pbError } from "../lib/pb";
import type { ApiToken, RequestLog } from "../lib/types";

const PER_PAGE = 40;

export function Logs() {
  const toast = useToast();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokenFilter, setTokenFilter] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const filters: string[] = [];
      if (tokenFilter) filters.push(`token = "${tokenFilter}"`);
      if (onlyErrors) filters.push("status_code >= 400");

      const result = await pb.collection("request_logs").getList<RequestLog>(page, PER_PAGE, {
        sort: "-created",
        ...(filters.length ? { filter: filters.join(" && ") } : {}),
      });
      setLogs(result.items);
      setTotalPages(result.totalPages || 1);
    } catch (error) {
      toast.error(pbError(error, "Não consegui carregar os logs"));
    } finally {
      setLoading(false);
    }
  }, [page, tokenFilter, onlyErrors, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    pb.collection("api_tokens")
      .getFullList<ApiToken>({ sort: "name" })
      .then(setTokens)
      .catch(() => setTokens([]));
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  return (
    <>
      <PageHeader
        icon="📋"
        title="Requisições"
        description="Toda chamada à API fica registrada aqui: quem pediu, quanto tempo levou e se veio do cache."
        actions={
          <Button icon={<IconRefresh size={14} />} onClick={() => void load()}>
            Atualizar
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            value={tokenFilter}
            onChange={(event) => {
              setPage(1);
              setTokenFilter(event.target.value);
            }}
          >
            <option value="">Todos os tokens</option>
            {tokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(event) => {
              setPage(1);
              setOnlyErrors(event.target.checked);
            }}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Só erros
        </label>

        <div className="w-48">
          <Toggle
            checked={autoRefresh}
            onChange={setAutoRefresh}
            label="Atualizar sozinho"
            hint="a cada 5 segundos"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-faint">Carregando…</p>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<IconList size={26} />}
          title="Nenhuma requisição registrada"
          description="Faça um teste no Playground ou chame a API com um token para ver as linhas aparecerem aqui."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Texto</Th>
                <Th>Token</Th>
                <Th>Voz</Th>
                <Th className="text-right">Áudio</Th>
                <Th className="text-right">Tempo</Th>
                <Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-hover/60">
                  <Td className="whitespace-nowrap text-[12px] text-faint">
                    {formatDate(log.created)}
                  </Td>
                  <Td className="max-w-[260px]">
                    <span className="block truncate text-[13px]" title={log.text_preview}>
                      {truncate(log.text_preview || "—", 60)}
                    </span>
                    {log.error && (
                      <span className="block truncate text-[11px] text-danger" title={log.error}>
                        {log.error}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[12px] text-muted">{log.token_name || "—"}</Td>
                  <Td className="text-[12px] text-muted">{log.voice_name || "—"}</Td>
                  <Td className="text-right font-mono text-[12px] tabular-nums text-muted">
                    {log.audio_ms ? `${(log.audio_ms / 1000).toFixed(1)}s` : "—"}
                  </Td>
                  <Td className="text-right font-mono text-[12px] tabular-nums">
                    {formatMs(log.duration_ms || 0)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {log.cached && <Badge tone="success">cache</Badge>}
                      <span
                        className={cx(
                          "font-mono text-[12px] tabular-nums",
                          log.status_code >= 400 ? "text-danger" : "text-faint",
                        )}
                      >
                        {log.status_code}
                      </span>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12px] text-faint">
              <span>
                página {page} de {totalPages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
