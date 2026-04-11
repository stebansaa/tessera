import { Client, type ClientChannel } from "ssh2";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

/**
 * SSH "PTY" backend.
 *
 * Wraps an `ssh2.Client` + the interactive shell channel it returns from
 * `client.shell()`, exposing the same minimal Connection shape that the
 * main-process pty handler uses for node-pty:
 *
 *   { write(data), resize(cols, rows), kill(), onData(cb), onExit(cb) }
 *
 * That symmetry means the rest of main doesn't care whether a tab is
 * local or remote — both branches go into the same `Map<id, Connection>`
 * and the renderer drives them through the same `pty:write/resize/kill`
 * IPC channels.
 *
 * Phase 1 scope: connect with key auth or password auth, pipe data, exit
 * cleanly. No reconnect, no host key verification (we accept on first
 * use), no agent forwarding, no port forwarding. Those land in Phase 3.
 */

export interface SshSpawnOptions {
  host: string;
  port: number;
  username: string;
  cols: number;
  rows: number;
  /** Path to a private key file. `~` is expanded to $HOME. */
  identityFile?: string | null;
  /** Cleartext password (already decrypted from safeStorage). */
  password?: string | null;
  /** Remote directory to cd into after the shell opens. */
  startDir?: string | null;
}

export interface Connection {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (info: { exitCode: number; signal?: number }) => void): void;
}

/** Expand a leading `~` (and `~/`) to the user's home directory. */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

export function spawnSsh(opts: SshSpawnOptions): Promise<Connection> {
  return new Promise((resolveP, rejectP) => {
    const client = new Client();

    // Read the key file synchronously up front so any file-not-found error
    // surfaces *before* we attempt the network connection — clearer error
    // message for the user.
    let privateKey: Buffer | undefined;
    if (opts.identityFile) {
      try {
        privateKey = readFileSync(expandHome(opts.identityFile));
      } catch (err) {
        rejectP(
          new Error(
            `Could not read key file "${opts.identityFile}": ${
              (err as Error).message
            }`,
          ),
        );
        return;
      }
    }

    let stream: ClientChannel | null = null;
    const dataHandlers: ((data: string) => void)[] = [];
    const exitHandlers: ((info: {
      exitCode: number;
      signal?: number;
    }) => void)[] = [];
    let exited = false;

    client.on("ready", () => {
      client.shell(
        {
          term: "xterm-256color",
          cols: opts.cols,
          rows: opts.rows,
        },
        (err, ch) => {
          if (err) {
            client.end();
            rejectP(err);
            return;
          }
          stream = ch;

          // ssh2 streams are object/Buffer mode by default — convert to
          // utf8 strings so we can hand them straight to xterm.write.
          ch.on("data", (chunk: Buffer | string) => {
            const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            for (const h of dataHandlers) h(s);
          });
          // stderr from the remote (rare for an interactive shell, but
          // possible) is funneled into the same stream so the user sees it.
          ch.stderr.on("data", (chunk: Buffer | string) => {
            const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            for (const h of dataHandlers) h(s);
          });

          ch.on("close", () => {
            if (exited) return;
            exited = true;
            for (const h of exitHandlers) h({ exitCode: 0 });
            client.end();
          });

          ch.on("exit", (code: number, signal?: string) => {
            if (exited) return;
            exited = true;
            for (const h of exitHandlers) {
              h({ exitCode: code ?? 0, signal: signal ? 0 : undefined });
            }
          });

          // If a startDir is configured, cd into it immediately.
          // We send a clear-line + cd + clear-screen so the user sees
          // a clean prompt in the target directory.
          if (opts.startDir) {
            ch.write(`cd ${JSON.stringify(opts.startDir)} && clear\n`);
          }

          resolveP({
            write(data: string) {
              ch.write(data);
            },
            resize(cols: number, rows: number) {
              // ssh2 wants cols, rows, height, width — height/width are
              // pixel hints used by some apps; xterm gives us cells only,
              // so we pass 0 and let the remote ignore them.
              ch.setWindow(rows, cols, 0, 0);
            },
            kill() {
              try {
                ch.end();
              } catch {
                /* noop */
              }
              try {
                client.end();
              } catch {
                /* noop */
              }
            },
            onData(handler) {
              dataHandlers.push(handler);
            },
            onExit(handler) {
              exitHandlers.push(handler);
            },
          });
        },
      );
    });

    client.on("error", (err) => {
      if (exited) return;
      exited = true;
      // If the connection failed before `shell()` resolved we still owe
      // the caller a rejection; otherwise surface as an exit so the open
      // terminal sees the error message and a "process exited" line.
      if (!stream) {
        rejectP(err);
      } else {
        for (const h of exitHandlers) h({ exitCode: 255 });
      }
    });

    client.on("close", () => {
      if (exited) return;
      exited = true;
      for (const h of exitHandlers) h({ exitCode: 0 });
    });

    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey,
      password: opts.password ?? undefined,
      // Phase 1: trust on first use. Phase 3 will store known_hosts and
      // verify properly.
      readyTimeout: 15_000,
    });
  });
}
