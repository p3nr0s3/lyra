import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/corsHeaders";
import { assertOllamaHostUrl, SsrfBlockedError } from "@/lib/ssrfGuard";
import { normalizeAtomicBaseUrl } from "@/lib/atomicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = getCorsHeaders();

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Lists the models an Atomic Chat server has loaded (GET {base}/models).
// Server-side so a remote/LAN Atomic Chat works without CORS, and so a key
// in ATOMIC_CHAT_API_KEY never reaches the browser.
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  let baseUrl: string;
  try {
    baseUrl = normalizeAtomicBaseUrl(process.env.ATOMIC_CHAT_BASE_URL || body.baseUrl);
  } catch {
    return NextResponse.json({ error: "Invalid Atomic Chat base URL." }, { status: 400, headers: CORS_HEADERS });
  }

  // LAN / loopback / public hosts are all legitimate here; only link-local
  // and cloud-metadata targets are refused (same policy as the Ollama host).
  try {
    await assertOllamaHostUrl(baseUrl);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Invalid Atomic Chat base URL." }, { status: 400, headers: CORS_HEADERS });
  }

  const apiKey = process.env.ATOMIC_CHAT_API_KEY || (typeof body.apiKey === "string" ? body.apiKey : "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Atomic Chat responded ${res.status} at ${baseUrl}/models` },
        { status: 502, headers: CORS_HEADERS }
      );
    }
    const data = await res.json();
    const models = (Array.isArray(data?.data) ? data.data : [])
      .map((m: any) => (typeof m?.id === "string" ? m.id : null))
      .filter(Boolean);
    return NextResponse.json({ baseUrl, models }, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not reach Atomic Chat at ${baseUrl}: ${err?.message || "network error"}` },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}
