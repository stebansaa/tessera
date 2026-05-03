import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, RefreshCw, Trash2 } from "lucide-react";
import type { BriefSummary, Session } from "../shared/ipc";

export type BriefMode = "paused" | "watching" | "summarizing";

export interface BriefPanelState {
  mode: BriefMode;
  summary: BriefSummary | null;
  pendingCount: number;
  error: string | null;
  observedSince: number | null;
}

interface Props {
  session: Session | null;
  state: BriefPanelState | undefined;
  onClear: (sessionId: string) => void;
  onSummarizeNow: (sessionId: string) => void;
}

export function BriefPanel({
  session,
  state,
  onClear,
  onSummarizeNow,
}: Props) {
  const mode = state?.mode ?? "paused";
  const busy = mode === "summarizing";
  const summary = state?.summary ?? null;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    followLatestRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 90;
    followLatestRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, []);

  useEffect(() => {
    followLatestRef.current = true;
    setShowJumpToLatest(false);
    window.requestAnimationFrame(() => scrollToLatest("auto"));
  }, [session?.id, scrollToLatest]);

  useEffect(() => {
    if (!followLatestRef.current) return;
    window.requestAnimationFrame(() => scrollToLatest("smooth"));
  }, [
    mode,
    state?.pendingCount,
    state?.error,
    summary?.updatedAt,
    scrollToLatest,
  ]);

  return (
    <aside className="relative flex h-full w-[330px] shrink-0 flex-col border-l border-divider bg-bg-header">
      <div className="flex h-11 items-center gap-2 border-b border-divider px-3">
        <BrainCircuit size={16} className="text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg-bright">
            Live brief
          </div>
          <div className="truncate text-[11px] text-fg-muted">
            {session ? session.name : "No session selected"}
          </div>
        </div>
        <StatusDot mode={mode} />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-themed flex-1 overflow-y-auto p-3"
      >
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => session && onSummarizeNow(session.id)}
            disabled={busy || (state?.pendingCount ?? 0) === 0}
            className="flex flex-1 items-center justify-center gap-2 rounded border border-divider bg-bg px-3 py-2 text-xs text-fg transition hover:bg-bg-active disabled:cursor-not-allowed disabled:opacity-40"
            title="Summarize pending events"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            Summarize now
          </button>

          <button
            type="button"
            onClick={() => session && onClear(session.id)}
            disabled={busy}
            className="flex items-center justify-center rounded border border-divider bg-bg px-3 py-2 text-xs text-fg-dim transition hover:bg-bg-active hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            title="Clear this brief"
          >
            <Trash2 size={13} />
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-divider bg-bg/70 p-3 text-xs leading-relaxed text-fg-muted">
          Live brief is enabled for this connection. Terminal batches are
          redacted before summarization, and AGENTS.md or CLAUDE.md is used as
          project context when available.
        </div>

        {state?.error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {state.error}
          </div>
        )}

        {summary ? (
          <div className="space-y-3">
            <Section title="Now">
              <p className="text-sm leading-relaxed text-fg-bright">{summary.now}</p>
            </Section>
            {summary.contextFile && (
              <Section title="Context">
                <p className="text-sm text-fg-muted">
                  Using {summary.contextFile}
                </p>
              </Section>
            )}
            <ListSection title="Recent" items={summary.recent} empty="No activity summarized yet." />
            <ListSection title="Issues" items={summary.issues} empty="No obvious issues yet." />
            <ListSection title="Next" items={summary.next} empty="No next steps yet." />
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-divider p-6 text-center text-sm text-fg-muted">
            Run commands in the terminal. The brief starts automatically.
          </div>
        )}
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          onClick={() => scrollToLatest()}
          className="absolute bottom-10 right-3 rounded-full border border-divider bg-bg px-3 py-1.5 text-[11px] text-fg shadow-lg transition hover:bg-bg-active hover:text-fg-bright"
        >
          Jump to latest
        </button>
      )}

      <div className="border-t border-divider px-3 py-2 text-[11px] text-fg-muted">
        <span>{modeLabel(mode)}</span>
        <span className="mx-2 text-fg-dim">/</span>
        <span>{state?.pendingCount ?? 0} pending events</span>
        {summary && (
          <>
            <span className="mx-2 text-fg-dim">/</span>
            <span>{formatUpdated(summary.updatedAt)}</span>
          </>
        )}
      </div>
    </aside>
  );
}

function StatusDot({ mode }: { mode: BriefMode }) {
  const color =
    mode === "summarizing"
      ? "bg-accent"
      : mode === "watching"
        ? "bg-dot-on"
        : "bg-dot-off";
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-divider bg-bg/70 p-3">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ListSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <Section title={title}>
      {items.length > 0 ? (
        <ul className="list-disc space-y-1.5 pl-4">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className="text-sm leading-relaxed text-fg">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{empty}</p>
      )}
    </Section>
  );
}

function modeLabel(mode: BriefMode): string {
  if (mode === "watching") return "Watching";
  if (mode === "summarizing") return "Summarizing";
  return "Paused";
}

function formatUpdated(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
