import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink } from "lucide-react";

interface Props {
  tabId: string;
  initialUrl?: string;
  onUrlChange: (url: string) => void;
}

/**
 * Embedded web page tab using Electron's <webview> tag. Shows a URL bar
 * at the top and the page below. Unlike iframes, webview runs in its own
 * renderer process and isn't blocked by X-Frame-Options.
 *
 * The URL is persisted via onUrlChange so it survives tab switches and
 * app restarts.
 */
export function WebviewTab({ tabId, initialUrl, onUrlChange }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [input, setInput] = useState(initialUrl ?? "");
  const webviewRef = useRef<Electron.WebviewTag | null>(null);

  const navigate = useCallback(
    (raw: string) => {
      let target = raw.trim();
      if (!target) return;
      if (!/^https?:\/\//i.test(target)) {
        target = `https://${target}`;
      }
      setUrl(target);
      setInput(target);
      onUrlChange(target);
    },
    [onUrlChange],
  );

  // Sync the URL bar when the user navigates within the webview (clicking
  // links, redirects, etc.).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onNavigate = (e: Electron.DidNavigateEvent) => {
      setInput(e.url);
      onUrlChange(e.url);
    };

    wv.addEventListener("did-navigate", onNavigate as EventListener);
    wv.addEventListener("did-navigate-in-page", onNavigate as EventListener);
    return () => {
      wv.removeEventListener("did-navigate", onNavigate as EventListener);
      wv.removeEventListener(
        "did-navigate-in-page",
        onNavigate as EventListener,
      );
    };
  }, [url, onUrlChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      navigate(input);
    }
  };

  const handleBack = () => webviewRef.current?.goBack();
  const handleForward = () => webviewRef.current?.goForward();
  const handleReload = () => webviewRef.current?.reload();

  const handleOpenExternal = () => {
    const current = webviewRef.current?.getURL() || url;
    if (current) window.open(current, "_blank");
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* URL bar */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-divider bg-bg-header px-2">
        <button
          onClick={handleBack}
          title="Back"
          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition hover:bg-white/[0.06] hover:text-fg"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          onClick={handleForward}
          title="Forward"
          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition hover:bg-white/[0.06] hover:text-fg"
        >
          <ArrowRight size={14} />
        </button>
        <button
          onClick={handleReload}
          title="Reload"
          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition hover:bg-white/[0.06] hover:text-fg"
        >
          <RotateCw size={13} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL…"
          className="mx-1 min-w-0 flex-1 rounded border border-divider bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          onClick={handleOpenExternal}
          title="Open in browser"
          className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition hover:bg-white/[0.06] hover:text-fg"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {/* Content */}
      {url ? (
        <webview
          ref={webviewRef as React.Ref<Electron.WebviewTag>}
          key={tabId}
          src={url}
          style={{ flex: 1 }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
          Type a URL above to get started
        </div>
      )}
    </div>
  );
}
