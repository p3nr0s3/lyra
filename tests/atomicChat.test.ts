import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as chatPOST } from "../app/api/cloud/chat/route";
import { POST as modelsPOST } from "../app/api/atomic/models/route";
import { normalizeAtomicBaseUrl, toAtomicModelId, fromAtomicModelId } from "../lib/atomicChat";
import { detectModelProvider } from "../lib/ollama";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function post(handler: (req: NextRequest) => Promise<Response>, path: string, body: Record<string, any>) {
  return handler(
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("atomic chat helpers", () => {
  it("normalizes pasted base URLs to .../v1", () => {
    expect(normalizeAtomicBaseUrl("")).toBe("http://127.0.0.1:1337/v1");
    expect(normalizeAtomicBaseUrl("192.168.1.5:1337")).toBe("http://192.168.1.5:1337/v1");
    expect(normalizeAtomicBaseUrl("http://localhost:1337/")).toBe("http://127.0.0.1:1337/v1");
    expect(normalizeAtomicBaseUrl("https://x.tunnel.app/v1/")).toBe("https://x.tunnel.app/v1");
    expect(() => normalizeAtomicBaseUrl("ftp://host")).toThrow();
  });

  it("round-trips the atomic: model prefix and routes it to the atomic provider", () => {
    expect(toAtomicModelId("qwen3-4b")).toBe("atomic:qwen3-4b");
    expect(toAtomicModelId("atomic:qwen3-4b")).toBe("atomic:qwen3-4b");
    expect(fromAtomicModelId("atomic:qwen3-4b")).toBe("qwen3-4b");
    expect(detectModelProvider("atomic:llama-3.2-3b")).toBe("atomic");
    expect(detectModelProvider("llama3.2:3b")).toBe("ollama");
  });
});

describe("atomic chat routes", () => {
  it("streams chat to {base}/v1/chat/completions with the prefix stripped and no key required", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));
    global.fetch = spy as any;
    const res = await post(chatPOST, "/api/cloud/chat", {
      provider: "atomic",
      model: "atomic:qwen3-4b",
      atomicBaseUrl: "127.0.0.1:1337",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:1337/v1/chat/completions");
    expect(JSON.parse(init.body).model).toBe("qwen3-4b");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.redirect).toBe("manual");
  });

  it("sends the key as a bearer token when one is configured", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));
    global.fetch = spy as any;
    await post(chatPOST, "/api/cloud/chat", { provider: "atomic", model: "atomic:m", apiKey: "secret", messages: [] });
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("refuses a link-local / metadata base URL without calling it", async () => {
    const spy = vi.fn();
    global.fetch = spy as any;
    const res = await post(chatPOST, "/api/cloud/chat", {
      provider: "atomic",
      model: "atomic:m",
      atomicBaseUrl: "http://169.254.169.254",
      messages: [],
    });
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("lists models from {base}/v1/models", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: "list", data: [{ id: "qwen3-4b" }, { id: "gemma-3-1b" }] }), { status: 200 })
    );
    global.fetch = spy as any;
    const res = await post(modelsPOST, "/api/atomic/models", { baseUrl: "http://10.0.0.7:1337" });
    expect(res.status).toBe(200);
    expect(String(spy.mock.calls[0][0])).toBe("http://10.0.0.7:1337/v1/models");
    expect((await res.json()).models).toEqual(["qwen3-4b", "gemma-3-1b"]);
  });

  it("reports an unreachable server as 502 with a reason", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;
    const res = await post(modelsPOST, "/api/atomic/models", { baseUrl: "http://127.0.0.1:1337" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("ECONNREFUSED");
  });
});
