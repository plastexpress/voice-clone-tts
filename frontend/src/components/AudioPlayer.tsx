/** Player compacto: play/pause, barra de progresso e download. */

import { useEffect, useRef, useState } from "react";
import { IconDownload, IconPause, IconPlay } from "./icons";
import { cx } from "./ui";
import { formatDuration } from "../lib/format";

export function AudioPlayer({
  src,
  filename = "audio.opus",
  compact = false,
  className,
}: {
  src: string;
  filename?: string;
  compact?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setTotal(0);
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * total;
  }

  const progress = total ? (current / total) * 100 : 0;

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-md border border-line bg-subtle px-2.5",
        compact ? "py-1.5" : "py-2",
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          setTotal(Number.isFinite(duration) ? duration : 0);
        }}
      />

      <button
        onClick={toggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 focus-ring"
        aria-label={playing ? "Pausar" : "Reproduzir"}
      >
        {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
      </button>

      <div
        className="group relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-line-strong"
        onClick={seek}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
        {formatDuration(current * 1000)} / {formatDuration(total * 1000)}
      </span>

      <a
        href={src}
        download={filename}
        className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
        title="Baixar"
      >
        <IconDownload size={14} />
      </a>
    </div>
  );
}
