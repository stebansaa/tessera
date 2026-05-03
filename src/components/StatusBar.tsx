import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { api } from "../lib/api";

interface StatusBarProps {
  sessions: number;
  transfer?: TransferStatus | null;
}

export interface TransferStatus {
  direction: "upload" | "download";
  bytes: number;
  active: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTransferBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StatusBar({ sessions, transfer }: StatusBarProps) {
  const [ram, setRam] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const poll = () => {
      api.system.memoryUsage().then((bytes) => setRam(formatBytes(bytes)));
      api.system.isFullscreen().then(setFullscreen);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const toggle = async () => {
    const next = await api.system.toggleFullscreen();
    setFullscreen(next);
  };

  return (
    <div className="flex h-6 items-center gap-4 border-t border-divider bg-bg-header px-3 text-[11px] text-fg-muted">
      <span>
        <span className="text-dot-on">●</span> {sessions} connections
      </span>
      {transfer && (
        <span
          className={[
            "flex items-center gap-1.5 font-mono transition",
            transfer.active ? "text-accent" : "text-fg-muted/60",
          ].join(" ")}
          title="Terminal transfer activity"
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              transfer.active ? "animate-pulse bg-accent" : "bg-fg-muted/40",
            ].join(" ")}
          />
          <span>user</span>
          <span className={transfer.active ? "text-accent" : "text-fg-muted/60"}>
            {transfer.direction === "upload" ? ">>>" : "<<<"}
          </span>
          <span>server</span>
          <span>{formatTransferBytes(transfer.bytes)}</span>
        </span>
      )}
      {ram && <span className="text-fg-muted/70">RAM {ram}</span>}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-fg-muted/70">tessera</span>
        <button
          onClick={toggle}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="text-fg-muted transition hover:text-fg-bright"
        >
          {fullscreen ? <Minimize size={12} /> : <Maximize size={12} />}
        </button>
      </span>
    </div>
  );
}
