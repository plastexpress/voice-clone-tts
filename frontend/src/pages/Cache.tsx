import { Fragment, useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Layout";
import { AudioPlayer } from "../components/AudioPlayer";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Table,
  Td,
  Th,
} from "../components/ui";
import { IconDatabase, IconPlay, IconRefresh, IconSearch, IconTrash } from "../components/icons";
import { api } from "../lib/api";
import { formatBytes, formatDate, formatDuration, formatMs, truncate } from "../lib/format";
import { pb, pbError } from "../lib/pb";
import type { CacheEntry, CacheStats } from "../lib/types";

const PER_PAGE = 30;

export function CachePage() {
  const toast = useToast();
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [removing, setRemoving] = useState<CacheEntry | null>(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filter = search.trim() ? `text ~ ${JSON.stringify(search.trim())}` : "";
      const result = await pb.collection("tts_cache").getList<CacheEntry>(page, PER_PAGE, {
        sort: "-created",
        expand: "voice",
        ...(filter ? { filter } : {}),
      });
      setEntries(result.items);
      setTotalPages(result.totalPages || 1);
    } catch (error) {
      toast.error(pbError(error, "Não consegui listar o cache"));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.status().then((status) => status.cache));
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  async function play(entry: CacheEntry) {
    if (playing?.id === entry.id) {
      URL.revokeObjectURL(playing.url);
      setPlaying(null);
      return;
    }
    try {
      const { url } = await api.audioObjectUrl(entry.id);
      if (playing) URL.revokeObjectURL(playing.url);
      setPlaying({ id: entry.id, url });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await api.deleteCacheEntry(removing.id);
      toast.success("Áudio removido do cache");
      setRemoving(null);
      await Promise.all([load(), loadStats()]);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function purgeAll() {
    setPurging(true);
    try {
      const result = await api.purgeCache();
      toast.success(`${result.removed} arquivos removidos`);
      setPage(1);
      await Promise.all([load(), loadStats()]);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPurging(false);
    }
  }

  return (
    <>
      <PageHeader
        icon="💾"
        title="Cache de áudio"
        description="Cada arquivo aqui é uma geração que não precisa ser refeita. Mesmo texto, mesma voz e mesmos parâmetros retornam este arquivo."
        actions={
          <>
            <Button icon={<IconRefresh size={14} />} onClick={() => void load()}>
              Atualizar
            </Button>
            <Button variant="danger" loading={purging} onClick={purgeAll}>
              Limpar tudo
            </Button>
          </>
        }
      />

      {stats && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="accent">{stats.entries.toLocaleString("pt-BR")} arquivos</Badge>
          <Badge>{formatBytes(stats.size_bytes)}</Badge>
          <Badge>{stats.audio_hours} h de áudio</Badge>
          <Badge tone="success">{stats.hits.toLocaleString("pt-BR")} reaproveitamentos</Badge>
          <span className="text-faint">limite de {stats.limit_gb} GB</span>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Buscar pelo texto…"
            className="pl-8"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-faint">Carregando…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<IconDatabase size={26} />}
          title={search ? "Nada encontrado" : "Cache vazio"}
          description={
            search
              ? "Nenhum áudio no cache contém esse texto."
              : "Assim que a API gerar o primeiro áudio, ele aparece aqui."
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th />
                <Th>Texto</Th>
                <Th>Voz</Th>
                <Th className="text-right">Duração</Th>
                <Th className="text-right">Tamanho</Th>
                <Th className="text-right">Usos</Th>
                <Th className="text-right">Criado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className="group transition-colors hover:bg-hover/60">
                    <Td className="w-px">
                      <button
                        onClick={() => play(entry)}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-faint transition-colors hover:border-accent hover:text-accent"
                        title="Ouvir"
                      >
                        <IconPlay size={11} />
                      </button>
                    </Td>
                    <Td className="max-w-[300px]">
                      <span className="block truncate text-[13px]" title={entry.text}>
                        {truncate(entry.text, 70)}
                      </span>
                    </Td>
                    <Td>
                      {entry.expand?.voice ? (
                        <Badge tone="purple">{entry.expand.voice.name}</Badge>
                      ) : (
                        <span className="text-[12px] text-faint">—</span>
                      )}
                    </Td>
                    <Td className="text-right font-mono text-[12px] tabular-nums">
                      {formatDuration(entry.duration_ms)}
                    </Td>
                    <Td className="text-right font-mono text-[12px] tabular-nums text-muted">
                      {formatBytes(entry.size_bytes)}
                    </Td>
                    <Td className="text-right font-mono text-[12px] tabular-nums">
                      {entry.hits || 0}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-[12px] text-faint">
                      {formatDate(entry.created)}
                    </Td>
                    <Td className="w-px">
                      <button
                        onClick={() => setRemoving(entry)}
                        className="rounded p-1 text-faint opacity-0 transition-all hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                        title="Remover"
                      >
                        <IconTrash size={14} />
                      </button>
                    </Td>
                  </tr>
                  {playing?.id === entry.id && (
                    <tr>
                      <Td className="bg-subtle" />
                      <td colSpan={7} className="border-b border-line bg-subtle px-3 py-2">
                        <AudioPlayer compact src={playing.url} filename={`${entry.id}.opus`} />
                        <p className="mt-1.5 text-[11px] text-faint">
                          gerado em {formatMs(entry.generation_ms)} · {entry.format} ·{" "}
                          {entry.bitrate} · {entry.sample_rate} Hz · {entry.channels} canal(is)
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
                <Button
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remover do cache"
        confirmLabel="Remover"
        message="O arquivo é apagado do disco. Na próxima requisição com esse mesmo texto o áudio será gerado de novo."
      />
    </>
  );
}
