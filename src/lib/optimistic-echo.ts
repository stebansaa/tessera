/**
 * Adaptive local echo for SSH terminals.
 *
 * SSH normally waits for the remote PTY to echo each printable character.
 * On high-latency links that makes typing feel broken. This controller
 * writes only low-risk printable ASCII locally, then suppresses the matching
 * remote echo when it arrives.
 *
 * Safety rules:
 * - arm only after a normal-looking shell prompt or direct remote echo
 * - never echo paste/control/escape input
 * - disable around password-like prompts
 * - disable inside alternate-screen/full-screen apps
 * - disable after cursor-control redraws used by TUIs and fancy prompts
 */

interface PendingChar {
  ch: string;
  expiresAt: number;
}

const ECHO_TTL_MS = 1_500;
const PROBE_TTL_MS = 1_500;
const CONTROL_QUIET_MS = 1_200;
const ALT_SCREEN_QUIET_MS = 500;
const MAX_PENDING = 128;
const MAX_RECENT_PLAIN = 2_000;
const MAX_PROMPT_LINE = 240;

const PRINTABLE_ASCII = /^[ -~]$/;
const ALT_SCREEN_RE = /\x1b\[\?(47|1047|1049)([hl])/g;
const DISRUPTIVE_CSI_RE = /\x1b\[[0-?]*[ -/]*[ABCDHfJKSTsu]/g;
const SENSITIVE_PROMPT_RE =
  /\b(?:password|passphrase|passcode|pin|otp|one[- ]time|verification code|2fa|mfa|token|secret)\b[^\r\n]{0,120}[:?]\s*$/i;
const SHELL_PROMPT_RE =
  /(?:^|[\s\])}>"'`])(?:[$#%>]|❯|❮|➜|λ)\s*$/u;

function isPrintableAscii(data: string): boolean {
  return data.length === 1 && PRINTABLE_ASCII.test(data);
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function hasTerminalControl(data: string): boolean {
  return /[\x00-\x1f\x7f]|\x1b/.test(data);
}

function isPrintableOnly(data: string): boolean {
  return data.length > 0 && [...data].every((ch) => PRINTABLE_ASCII.test(ch));
}

function isLikelyShellPrompt(line: string): boolean {
  const trimmedRight = line.replace(/\s+$/, "");
  if (!trimmedRight || trimmedRight.length > MAX_PROMPT_LINE) return false;
  if (SENSITIVE_PROMPT_RE.test(trimmedRight)) return false;
  if (/^(?:yes\/no|y\/n|\[y\/n\])[:?]?$/i.test(trimmedRight)) return false;
  return SHELL_PROMPT_RE.test(trimmedRight);
}

export class OptimisticEchoController {
  private enabled = false;
  private trustedDirectEcho = false;
  private altScreen = false;
  private sensitivePrompt = false;
  private resumeAfterSensitiveOutput = false;
  private disabledUntil = 0;
  private pendingEcho: PendingChar[] = [];
  private probeEcho: PendingChar[] = [];
  private recentPlain = "";

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.resetEphemeralState();
  }

  handleLocalInput(data: string, now = Date.now()): string | null {
    this.expire(now);
    if (!this.enabled) return null;

    if (data === "\r" || data === "\n") {
      if (this.sensitivePrompt) this.resumeAfterSensitiveOutput = true;
      // After a submitted command, wait for the next normal prompt or direct
      // echo before local echo resumes. That avoids leaking hidden input.
      this.trustedDirectEcho = false;
      this.probeEcho = [];
      return null;
    }

    if (!isPrintableAscii(data)) {
      this.pauseForControl(now, true);
      return null;
    }

    if (!this.canEcho(now)) {
      this.trackProbe(data, now);
      return null;
    }

    // Keep prediction bounded. Multiple pending local characters can drift
    // visually when remote shells echo in chunks or redraw the prompt.
    if (this.pendingEcho.length > 0) return null;

    this.pendingEcho.push({ ch: data, expiresAt: now + ECHO_TTL_MS });
    if (this.pendingEcho.length > MAX_PENDING) {
      this.pendingEcho.splice(0, this.pendingEcho.length - MAX_PENDING);
    }
    return data;
  }

  handleRemoteData(data: string, now = Date.now()): string {
    if (!data) return data;
    if (this.pendingEcho.length > 0 && hasTerminalControl(data)) {
      const rollback = this.rollbackPendingEcho();
      this.pauseForControl(now);
      this.observeRemoteState(data, now);
      return rollback + data;
    }
    this.observeRemoteState(data, now);
    this.observeProbeEcho(data, now);
    return this.stripPendingEcho(data, now);
  }

  private canEcho(now: number): boolean {
    return (
      this.enabled &&
      this.trustedDirectEcho &&
      !this.altScreen &&
      !this.sensitivePrompt &&
      now >= this.disabledUntil
    );
  }

  private observeRemoteState(data: string, now: number) {
    this.observeAltScreen(data, now);

    if (DISRUPTIVE_CSI_RE.test(data) || /\r(?!\n)/.test(data)) {
      this.pauseForControl(now);
    }
    DISRUPTIVE_CSI_RE.lastIndex = 0;

    const plain = stripAnsi(data).replace(/\r/g, "\n");
    if (plain) {
      this.recentPlain = (this.recentPlain + plain).slice(-MAX_RECENT_PLAIN);
    }

    const lastLine = this.recentPlain.split("\n").pop() ?? "";
    const looksSensitive = SENSITIVE_PROMPT_RE.test(lastLine);

    if (looksSensitive) {
      this.sensitivePrompt = true;
      this.trustedDirectEcho = false;
      this.pendingEcho = [];
      this.probeEcho = [];
      return;
    }

    if (!this.altScreen && isLikelyShellPrompt(lastLine)) {
      this.sensitivePrompt = false;
      this.resumeAfterSensitiveOutput = false;
      this.trustedDirectEcho = true;
      this.probeEcho = [];
      this.disabledUntil = 0;
    }

    if (this.resumeAfterSensitiveOutput && /[\r\n]/.test(data)) {
      this.sensitivePrompt = false;
      this.resumeAfterSensitiveOutput = false;
      this.disabledUntil = Math.max(this.disabledUntil, now + CONTROL_QUIET_MS);
    }
  }

  private observeAltScreen(data: string, now: number) {
    let match: RegExpExecArray | null;
    ALT_SCREEN_RE.lastIndex = 0;
    while ((match = ALT_SCREEN_RE.exec(data))) {
      this.altScreen = match[2] === "h";
      this.trustedDirectEcho = false;
      this.pendingEcho = [];
      this.probeEcho = [];
      this.disabledUntil = Math.max(this.disabledUntil, now + ALT_SCREEN_QUIET_MS);
    }
  }

  private observeProbeEcho(data: string, now: number) {
    this.expire(now);
    if (
      this.probeEcho.length === 0 ||
      this.altScreen ||
      this.sensitivePrompt ||
      now < this.disabledUntil
    ) {
      return;
    }

    let idx = 0;
    let hits = 0;
    while (
      idx < data.length &&
      this.probeEcho.length > 0 &&
      data[idx] === this.probeEcho[0].ch
    ) {
      this.probeEcho.shift();
      idx += 1;
      hits += 1;
    }

    if (hits > 0) {
      this.trustedDirectEcho = true;
    }
  }

  private stripPendingEcho(data: string, now: number): string {
    this.expire(now);
    if (!this.canStripEcho() || this.pendingEcho.length === 0) return data;

    let idx = 0;
    while (
      idx < data.length &&
      this.pendingEcho.length > 0 &&
      data[idx] === this.pendingEcho[0].ch
    ) {
      this.pendingEcho.shift();
      idx += 1;
    }
    if (idx > 0) return data.slice(idx);

    // If plain printable server echo does not match the optimistic queue,
    // our visual prediction is wrong. Roll back immediately and let the
    // server's bytes become authoritative for the line.
    if (isPrintableOnly(data)) {
      const rollback = this.rollbackPendingEcho();
      this.pauseForControl(now);
      return rollback + data;
    }

    return data;
  }

  private canStripEcho(): boolean {
    return this.enabled && !this.altScreen && !this.sensitivePrompt;
  }

  private trackProbe(ch: string, now: number) {
    if (this.altScreen || this.sensitivePrompt || now < this.disabledUntil) return;
    this.probeEcho.push({ ch, expiresAt: now + PROBE_TTL_MS });
    if (this.probeEcho.length > MAX_PENDING) {
      this.probeEcho.splice(0, this.probeEcho.length - MAX_PENDING);
    }
  }

  private pauseForControl(now: number, keepPending = false) {
    this.trustedDirectEcho = false;
    if (!keepPending) this.pendingEcho = [];
    this.probeEcho = [];
    this.disabledUntil = Math.max(this.disabledUntil, now + CONTROL_QUIET_MS);
  }

  private rollbackPendingEcho(): string {
    const count = this.pendingEcho.length;
    this.pendingEcho = [];
    return "\b \b".repeat(count);
  }

  private expire(now: number) {
    while (this.pendingEcho[0]?.expiresAt <= now) this.pendingEcho.shift();
    while (this.probeEcho[0]?.expiresAt <= now) this.probeEcho.shift();
  }

  private resetEphemeralState() {
    this.trustedDirectEcho = false;
    this.altScreen = false;
    this.sensitivePrompt = false;
    this.resumeAfterSensitiveOutput = false;
    this.disabledUntil = 0;
    this.pendingEcho = [];
    this.probeEcho = [];
    this.recentPlain = "";
  }
}
