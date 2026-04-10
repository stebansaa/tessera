import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "../lib/api";
import type { SearchResult } from "../shared/ipc";

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (sessionId: string) => void;
}

export function SearchOverlay({ open, onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    api.search.fts({ query: q, limit: 20 }).then((res) => {
      setResults(res.results);
      setSelected(0);
    });
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      onNavigate(results[selected].sessionId);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-divider bg-bg-header shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-divider px-4 py-3">
          <Search size={16} className="shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search transcript history..."
            className="flex-1 bg-transparent text-sm text-fg-bright outline-none placeholder:text-fg-muted"
          />
          <button
            onClick={onClose}
            className="shrink-0 text-fg-muted transition hover:text-fg-bright"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto scroll-themed">
          {query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-fg-muted">
              No results
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.chunkId}-${i}`}
              className={[
                "flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition",
                i === selected
                  ? "bg-white/[0.06] text-fg-bright"
                  : "text-fg hover:bg-white/[0.04]",
              ].join(" ")}
              onClick={() => {
                onNavigate(r.sessionId);
                onClose();
              }}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="text-xs text-fg-muted">{r.sessionName}</span>
              <span className="truncate text-sm">{formatSnippet(r.snippet)}</span>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="border-t border-divider px-4 py-2 text-xs text-fg-muted">
          <span className="mr-3">
            <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5">↑↓</kbd> navigate
          </span>
          <span className="mr-3">
            <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

/** Replace FTS5 highlight markers with styled spans (plain text for now). */
function formatSnippet(raw: string): string {
  // FTS5 wraps matches in « » — strip them for plain display.
  // A richer version could use dangerouslySetInnerHTML with <mark> tags.
  return raw.replace(/[«»]/g, "");
}
