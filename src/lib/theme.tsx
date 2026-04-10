import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_THEME, type ThemeSettings } from "../shared/ipc";
import { getScheme } from "./color-schemes";
import { api } from "./api";

/**
 * Theme settings live in SQLite (via the settings IPC). On boot we fetch
 * once, push the values onto :root as CSS variables, and re-apply on every
 * change. Components that need raw values (TerminalView for xterm options)
 * read them from `useTheme()`.
 */

interface ThemeContextValue {
  theme: ThemeSettings;
  setTheme: (next: ThemeSettings) => Promise<void>;
  loaded: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function hexToRgbTriplet(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return "95 179 250"; // fallback to default blue
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function applyToDom(theme: ThemeSettings) {
  const root = document.documentElement;
  const scheme = getScheme(theme.colorScheme);

  // Accent
  root.style.setProperty("--accent-rgb", hexToRgbTriplet(theme.accentColor));

  // UI scale
  root.style.setProperty("--ui-scale", String(theme.fontSize / 13));

  // UI chrome colors from the active scheme
  const { ui } = scheme;
  root.style.setProperty("--color-bg", ui.bg);
  root.style.setProperty("--color-bg-header", ui.bgHeader);
  root.style.setProperty("--color-bg-active", ui.bgActive);
  root.style.setProperty("--color-bg-footer", ui.bgFooter);
  root.style.setProperty("--color-divider", ui.divider);
  root.style.setProperty("--color-fg", ui.fg);
  root.style.setProperty("--color-fg-dim", ui.fgDim);
  root.style.setProperty("--color-fg-muted", ui.fgMuted);
  root.style.setProperty("--color-fg-bright", ui.fgBright);
  root.style.setProperty("--color-fg-button", ui.fgButton);
  root.style.setProperty("--color-dot-on", ui.dotOn);
  root.style.setProperty("--color-dot-off", ui.dotOff);
  root.style.setProperty("--color-dot-llm", ui.dotLlm);
  root.style.setProperty("--color-dot-web", ui.dotWeb);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSettings>(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    applyToDom(DEFAULT_THEME);
    let cancelled = false;
    api.settings.getTheme().then((t) => {
      if (cancelled) return;
      setThemeState(t);
      applyToDom(t);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback(async (next: ThemeSettings) => {
    setThemeState(next);
    applyToDom(next);
    await api.settings.setTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, loaded }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
