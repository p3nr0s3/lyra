// lib/atomicChat.ts
//
// Atomic Chat (github.com/AtomicBot-ai/Atomic-Chat) exposes an
// OpenAI-compatible server, by default on http://127.0.0.1:1337/v1. For
// remote access it is either bound to 0.0.0.0 (LAN) or reached through a
// tunnel, so the base URL is user-configured, like a remote Ollama host.
//
// Its model ids are arbitrary ("qwen3-4b", "llama-3.2-3b", ...) and would
// otherwise be detected as Ollama models, so Lyra stores them with an
// "atomic:" prefix and strips it before talking to the server.

export const ATOMIC_MODEL_PREFIX = "atomic:";
export const DEFAULT_ATOMIC_BASE_URL = "http://127.0.0.1:1337/v1";

export function isAtomicModelId(modelId: string): boolean {
  return modelId.startsWith(ATOMIC_MODEL_PREFIX);
}

export function toAtomicModelId(upstreamId: string): string {
  return isAtomicModelId(upstreamId) ? upstreamId : `${ATOMIC_MODEL_PREFIX}${upstreamId}`;
}

export function fromAtomicModelId(modelId: string): string {
  return isAtomicModelId(modelId) ? modelId.slice(ATOMIC_MODEL_PREFIX.length) : modelId;
}

/**
 * Accepts what people actually paste — "192.168.1.5:1337", "http://host:1337",
 * "https://x.tunnel.app/v1/" — and returns a base ending in /v1 with no
 * trailing slash. Throws on anything that isn't an http(s) URL.
 */
export function normalizeAtomicBaseUrl(raw: string | undefined | null): string {
  let value = (raw || "").trim() || DEFAULT_ATOMIC_BASE_URL;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Atomic Chat base URL must use http or https.");
  }
  // Same Windows ::1 ECONNREFUSED workaround the Ollama proxy uses.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";

  let path = url.pathname.replace(/\/+$/, "");
  if (!/\/v1$/.test(path)) path = `${path}/v1`;
  return `${url.origin}${path}`;
}
