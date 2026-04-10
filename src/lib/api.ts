/**
 * Thin typed wrapper around `window.api`.
 *
 * Exists so renderer code can `import { api } from '@/lib/api'` and stay
 * decoupled from the global. Future error handling, retries, or telemetry
 * land here, not in components.
 */
export const api = window.api;
