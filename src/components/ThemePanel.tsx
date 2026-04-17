import { useTheme } from "../lib/theme";
import { COLOR_SCHEMES } from "../lib/color-schemes";
import type { ThemeSettings } from "../shared/ipc";

/**
 * Appearance settings page. Lives inside SessionPanel as an overlay.
 * Changes are persisted immediately — no save/cancel flow.
 */

const ACCENT_COLORS: { value: string; label: string }[] = [
  { value: "#5fb3fa", label: "Blue" },
  { value: "#bb80f2", label: "Purple" },
  { value: "#59db89", label: "Green" },
  { value: "#f5a26b", label: "Orange" },
  { value: "#f57bb6", label: "Pink" },
  { value: "#e5c07b", label: "Amber" },
];

const FONT_FAMILIES = [
  "JetBrains Mono",
  "Fira Code",
  "Menlo",
  "Consolas",
  "Source Code Pro",
  "Courier New",
];

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];

export function ThemePanel() {
  const { theme, setTheme } = useTheme();

  const update = (patch: Partial<ThemeSettings>) =>
    setTheme({ ...theme, ...patch });

  return (
    <div className="scroll-themed h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col px-8 py-8">
        <h1 className="mb-1 text-xl font-medium text-fg-bright">Appearance</h1>
        <p className="mb-6 text-sm text-fg-muted">
          Customize the look and feel. Changes save automatically.
        </p>

        <div className="space-y-6">
          {/* Color scheme */}
          <Field label="Color scheme">
            <div className="grid grid-cols-4 gap-2">
              {COLOR_SCHEMES.map((s) => {
                const active = s.key === theme.colorScheme;
                return (
                  <button
                    key={s.key}
                    onClick={() => update({ colorScheme: s.key })}
                    className={[
                      "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition",
                      active
                        ? "border-accent"
                        : "border-transparent hover:border-divider",
                    ].join(" ")}
                  >
                    {/* Mini preview swatch */}
                    <div
                      className="flex h-10 w-full items-end gap-px overflow-hidden rounded"
                      style={{ background: s.ui.bg }}
                    >
                      <div
                        className="h-full w-5"
                        style={{ background: s.ui.bgHeader }}
                      />
                      <div className="flex flex-1 flex-col justify-end gap-px p-1">
                        <div
                          className="h-1 w-full rounded-sm"
                          style={{ background: s.terminal.green }}
                        />
                        <div
                          className="h-1 w-3/4 rounded-sm"
                          style={{ background: s.terminal.blue }}
                        />
                        <div
                          className="h-1 w-1/2 rounded-sm"
                          style={{ background: s.terminal.foreground, opacity: 0.5 }}
                        />
                      </div>
                    </div>
                    <span
                      className={[
                        "text-xs",
                        active ? "text-fg-bright" : "text-fg-muted",
                      ].join(" ")}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Accent color */}
          <Field label="Accent color">
            <div className="flex flex-wrap gap-2">
              {ACCENT_COLORS.map((c) => {
                const active =
                  c.value.toLowerCase() === theme.accentColor.toLowerCase();
                return (
                  <button
                    key={c.value}
                    onClick={() => update({ accentColor: c.value })}
                    title={c.label}
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-full border-2 transition",
                      active
                        ? "border-fg-bright"
                        : "border-transparent hover:border-divider",
                    ].join(" ")}
                    style={{ backgroundColor: c.value }}
                  />
                );
              })}
            </div>
          </Field>

          {/* Font */}
          <Field label="Font">
            <select
              value={theme.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>

          {/* Font size */}
          <Field label="Font size">
            <select
              value={theme.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} px
                </option>
              ))}
            </select>
          </Field>

          {/* Preview */}
          <Field label="Preview">
            <div
              className="rounded border border-divider px-4 py-3"
              style={{
                fontFamily: `"${theme.fontFamily}", ui-monospace, monospace`,
                fontSize: theme.fontSize,
                background: "var(--color-bg)",
                color: "var(--color-fg)",
              }}
            >
              <div>
                $ echo &quot;hello, tessera&quot;
              </div>
              <div style={{ color: "var(--color-fg-muted)" }}>
                hello, tessera
              </div>
              <div>
                $ <span className="text-accent">git</span> status
              </div>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      {children}
    </label>
  );
}
