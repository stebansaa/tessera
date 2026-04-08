interface StatusBarProps {
  sessions: number;
}

export function StatusBar({ sessions }: StatusBarProps) {
  return (
    <div className="flex h-6 items-center gap-4 border-t border-divider bg-bg-header px-3 text-[11px] text-fg-muted">
      <span>
        <span className="text-dot-on">●</span> {sessions} sessions
      </span>
      <span className="text-fg-muted/70">RAM 2.3 GB</span>
      <span className="text-fg-muted/70">CPU 12%</span>
      <span className="ml-auto text-fg-muted/70">workspace · dev</span>
    </div>
  );
}
