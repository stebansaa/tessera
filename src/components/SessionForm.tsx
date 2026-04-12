import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type {
  Session,
  SessionKind,
  SshAuthMethod,
  TerminalDetails,
} from "../shared/ipc";

type Mode =
  | { kind: "create" }
  | { kind: "edit"; sessionId: string };

interface Props {
  mode: Mode;
  onSaved: (session: Session) => void;
  onCancel: () => void;
  onDeleted?: (sessionId: string) => void;
}

const KINDS: { value: SessionKind; label: string }[] = [
  { value: "local", label: "Local terminal" },
  { value: "ssh", label: "SSH terminal" },
];

const AUTH_METHODS: { value: SshAuthMethod; label: string; hint: string }[] = [
  { value: "password", label: "Password", hint: "Stored in OS keychain" },
  { value: "key", label: "Key file", hint: "Path to a private key" },
];

const EMPTY_TERMINAL: TerminalDetails = {
  shellPath: null,
  startDir: null,
  host: null,
  username: null,
  port: null,
  authMethod: null,
  identityFile: null,
  hasPassword: false,
};

/**
 * Inline create/edit form for a session. Renders inside SessionPanel,
 * taking over the main content area instead of using a modal.
 *
 * In edit mode it fetches the full session details on mount and pre-fills
 * the inputs. The kind selector is disabled when editing — switching kinds
 * would mean rewriting the type-specific extension row, which is more work
 * than the user actually wants ("I just need to update the working dir").
 */
export function SessionForm({
  mode,
  onSaved,
  onCancel,
  onDeleted,
}: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SessionKind>("local");
  const [terminal, setTerminal] = useState<TerminalDetails>(EMPTY_TERMINAL);
  // Cleartext password lives in local component state only — never in
  // the persisted `terminal` object. Empty string + edit mode + hasPassword
  // means "leave the stored password alone"; otherwise we send what's here.
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(mode.kind === "edit");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);

  // Pre-fill from DB when editing
  useEffect(() => {
    if (mode.kind !== "edit") return;
    let cancelled = false;
    (async () => {
      const details = await api.sessions.getDetails({ id: mode.sessionId });
      if (cancelled || !details) return;
      setName(details.name);
      setKind(details.kind);
      setTerminal(details.terminal ?? EMPTY_TERMINAL);
      setLoading(false);
      // focus the name field once values are populated
      requestAnimationFrame(() => nameRef.current?.select());
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Focus on mount for create
  useEffect(() => {
    if (mode.kind === "create") nameRef.current?.focus();
  }, [mode.kind]);

  // Esc cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const isTerminal = kind === "local" || kind === "ssh";
  const isSsh = kind === "ssh";
  const canSubmit = name.trim().length > 0 && !submitting;

  // Default new SSH sessions to password auth so the form has *something*
  // selected — switching to a different option is one click.
  const authMethod: SshAuthMethod = terminal.authMethod ?? "password";

  /**
   * Decide what to send for the password field on update.
   *   - undefined: leave the stored password untouched (the renderer
   *                doesn't know what it is and we don't want to clear it)
   *   - string:    encrypt and replace
   * On create the rule is simpler: send the string or null.
   */
  const passwordForUpdate = (): string | null | undefined => {
    if (!isSsh || authMethod !== "password") return null;
    if (password.length > 0) return password;
    // Empty input + already-stored password → leave it alone.
    return terminal.hasPassword ? undefined : null;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (mode.kind === "create") {
        const session = await api.sessions.create({
          name: name.trim(),
          kind,
          shellPath: terminal.shellPath || null,
          startDir: terminal.startDir || null,
          host: isSsh ? terminal.host || null : null,
          username: isSsh ? terminal.username || null : null,
          port: isSsh ? terminal.port || null : null,
          authMethod: isSsh ? authMethod : null,
          identityFile:
            isSsh && authMethod === "key"
              ? terminal.identityFile || null
              : null,
          password:
            isSsh && authMethod === "password" && password.length > 0
              ? password
              : null,
        });
        onSaved(session);
      } else {
        await api.sessions.update({
          id: mode.sessionId,
          name: name.trim(),
          terminal: isTerminal
            ? {
                shellPath: terminal.shellPath || null,
                startDir: terminal.startDir || null,
                host: isSsh ? terminal.host || null : null,
                username: isSsh ? terminal.username || null : null,
                port: isSsh ? terminal.port || null : null,
                authMethod: isSsh ? authMethod : null,
                identityFile:
                  isSsh && authMethod === "key"
                    ? terminal.identityFile || null
                    : null,
                password: passwordForUpdate(),
              }
            : null,
        });
        // updateSession doesn't return the row; the parent will refetch.
        onSaved({
          id: mode.sessionId,
          projectId: "",  // backend manages this; parent refetches
          name: name.trim(),
          kind,
          position: 0,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const updateTerminal = (patch: Partial<TerminalDetails>) =>
    setTerminal((t) => ({ ...t, ...patch }));

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
        Loading…
      </div>
    );
  }

  return (
    // Two-layer wrapper: outer is full-width and owns the scroll so the
    // scrollbar lands at the right edge of the panel (not next to the
    // 560px-wide content). Inner column is centered and capped.
    <div className="scroll-themed h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col px-8 py-8">
      <h1 className="mb-1 text-xl font-medium text-fg-bright">
        {mode.kind === "create" ? "New connection" : "Connection settings"}
      </h1>
      <p className="mb-6 text-sm text-fg-muted">
        {mode.kind === "create"
          ? "Configure a new connection. You can change these later from the settings icon."
          : "Update connection details."}
      </p>

      <div className="space-y-4">
        <Field label="Name">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="my-session"
            className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </Field>

        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SessionKind)}
            disabled={mode.kind === "edit"}
            className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        {isTerminal && (
          <>
            <SectionDivider label="Terminal" />

            <Field label="Working directory">
              <input
                value={terminal.startDir ?? ""}
                onChange={(e) => updateTerminal({ startDir: e.target.value })}
                placeholder="Home-relative or absolute path"
                className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </Field>

            <Field label="Shell">
              <input
                value={terminal.shellPath ?? ""}
                onChange={(e) => updateTerminal({ shellPath: e.target.value })}
                placeholder="Leave blank to use the default shell"
                className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </Field>
          </>
        )}

        {isSsh && (
          <>
            <SectionDivider label="SSH" />

            <Field label="Host">
              <input
                value={terminal.host ?? ""}
                onChange={(e) => updateTerminal({ host: e.target.value })}
                placeholder="prod.example.com"
                className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            </Field>

            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="User">
                <input
                  value={terminal.username ?? ""}
                  onChange={(e) =>
                    updateTerminal({ username: e.target.value })
                  }
                  placeholder="root"
                  className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              </Field>

              <Field label="Port">
                <input
                  type="number"
                  value={terminal.port ?? ""}
                  onChange={(e) =>
                    updateTerminal({
                      port: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="22"
                  className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              </Field>
            </div>

            <Field label="Authentication">
              <div className="flex gap-2">
                {AUTH_METHODS.map((m) => {
                  const active = m.value === authMethod;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => updateTerminal({ authMethod: m.value })}
                      title={m.hint}
                      className={[
                        "flex-1 rounded border px-3 py-2 text-sm transition",
                        active
                          ? "border-accent bg-accent/10 text-fg-bright"
                          : "border-divider bg-bg-header text-fg-dim hover:text-fg",
                      ].join(" ")}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {authMethod === "password" && (
              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  // In edit mode, when a password is already stored, leave
                  // the field blank and tell the user typing will replace
                  // it. Empty submit keeps the existing one.
                  placeholder={
                    mode.kind === "edit" && terminal.hasPassword
                      ? "•••••• (stored — type to replace)"
                      : "Password"
                  }
                  className="w-full rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
              </Field>
            )}

            {authMethod === "key" && (
              <Field label="Private key">
                <div className="flex gap-2">
                  <input
                    value={terminal.identityFile ?? ""}
                    onChange={(e) =>
                      updateTerminal({ identityFile: e.target.value })
                    }
                    placeholder="Private key path"
                    className="min-w-0 flex-1 rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const path = await api.dialog.openFile({
                        title: "Select SSH private key",
                      });
                      if (path) updateTerminal({ identityFile: path });
                    }}
                    className="shrink-0 rounded border border-divider bg-bg-header px-3 py-2 text-sm text-fg-dim transition hover:text-fg"
                  >
                    Browse…
                  </button>
                </div>
              </Field>
            )}
          </>
        )}
      </div>

      <div className="mt-8 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-3 py-2 text-sm text-fg-dim transition hover:text-fg"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mode.kind === "create" ? "Create connection" : "Save changes"}
        </button>
      </div>

      {mode.kind === "edit" && onDeleted && (
        <div className="mt-12 rounded-lg border border-red-500/30 bg-red-500/[0.04] p-4">
          <SectionDivider label="Danger zone" />
          <p className="mt-3 text-sm text-fg-muted">
            Permanently delete this connection, including all terminal history
            and saved settings. This action cannot be undone.
          </p>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-3 rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
            >
              Delete this connection…
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-fg">
                Type <span className="font-semibold text-fg-bright">{name}</span> to
                confirm:
              </p>
              <input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={name}
                autoFocus
                className="w-full rounded border border-red-500/40 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-red-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteInput("");
                  }}
                  className="rounded px-3 py-1.5 text-sm text-fg-dim transition hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  disabled={deleteInput !== name || deleting}
                  onClick={async () => {
                    if (deleteInput !== name) return;
                    setDeleting(true);
                    try {
                      await api.sessions.delete({ id: mode.sessionId });
                      onDeleted(mode.sessionId);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
