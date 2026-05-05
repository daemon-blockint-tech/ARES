import test from "node:test";
import assert from "node:assert/strict";
import { AresClient } from "../client.js";
import { AresApiError, AresPaymentRequiredError } from "../types.js";

/**
 * Test the client against a fake fetch — verifies cookie capture, error
 * envelope unwrapping, 402 surfacing, and operator key header.
 */

function makeFakeFetch(
  handler: (req: { url: string; init: RequestInit }) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler({ url, init: init ?? {} });
  }) as unknown as typeof fetch;
}

test("client unwraps {ok:true,data} envelopes", async () => {
  const fakeFetch = makeFakeFetch(({ url }) => {
    assert.match(url, /\/api\/auth\/me$/);
    return new Response(
      JSON.stringify({ ok: true, requestId: "r1", data: { authenticated: false } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const client = new AresClient({ baseUrl: "http://x.test", fetchImpl: fakeFetch });
  const me = await client.me();
  assert.equal(me.authenticated, false);
});

test("client converts {ok:false,error} envelopes into AresApiError", async () => {
  const fakeFetch = makeFakeFetch(
    () =>
      new Response(
        JSON.stringify({
          ok: false,
          requestId: "r2",
          error: { code: "BAD_REQUEST", message: "nope" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );
  const client = new AresClient({ baseUrl: "http://x.test", fetchImpl: fakeFetch });
  await assert.rejects(client.chat("x"), (e: unknown) => {
    assert.ok(e instanceof AresApiError);
    assert.equal(e.code, "BAD_REQUEST");
    assert.equal(e.status, 400);
    assert.equal(e.requestId, "r2");
    return true;
  });
});

test("client raises AresPaymentRequiredError on HTTP 402", async () => {
  const fakeFetch = makeFakeFetch(
    () =>
      new Response("paywall", {
        status: 402,
        headers: {
          "content-type": "text/plain",
          "www-authenticate": 'Payment realm="ares"',
        },
      }),
  );
  const client = new AresClient({ baseUrl: "http://x.test", fetchImpl: fakeFetch });
  await assert.rejects(client.chat("x"), (e: unknown) => {
    assert.ok(e instanceof AresPaymentRequiredError);
    assert.equal(e.status, 402);
    assert.equal(e.wwwAuthenticate, 'Payment realm="ares"');
    return true;
  });
});

test("client sends x-api-key when apiKey is set", async () => {
  let captured: Record<string, string> = {};
  const fakeFetch = makeFakeFetch(({ init }) => {
    const h = init.headers as Record<string, string> | undefined;
    captured = h ?? {};
    return new Response(
      JSON.stringify({ ok: true, requestId: "x", data: { authenticated: false } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const client = new AresClient({
    baseUrl: "http://x.test",
    apiKey: "secret-key",
    fetchImpl: fakeFetch,
  });
  await client.me();
  assert.equal(captured["x-api-key"], "secret-key");
});

test("client captures Set-Cookie on sign-in flow", async () => {
  const fakeFetch = makeFakeFetch(({ url }) => {
    if (url.endsWith("/api/auth/verify")) {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append(
        "set-cookie",
        "asst_session=jwt-token-here; Path=/; HttpOnly; SameSite=Lax",
      );
      return new Response(
        JSON.stringify({
          ok: true,
          requestId: "x",
          data: { wallet: "abc", tier: "free", balanceUnits: 0 },
        }),
        { status: 200, headers },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, requestId: "x", data: { authenticated: false } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const client = new AresClient({ baseUrl: "http://x.test", fetchImpl: fakeFetch });
  // Manually call verify-equivalent via low-level path — replicate by setting cookies.
  // Easier: drive cookie capture by hitting any endpoint that returns Set-Cookie.
  await client.me(); // first ME — no Set-Cookie configured by handler for that path
  // Invoke a synthetic verify call via the public chat endpoint isn't representative;
  // instead, exercise auth via its concrete method:
  const { signInWithKeypair } = client;
  // We didn't pass a keypair; just simulate cookie capture by calling fetchImpl directly:
  await (
    client as unknown as { request: (m: string, p: string) => Promise<unknown> }
  ).request("POST", "/api/auth/verify");
  void signInWithKeypair; // avoid unused warning
  assert.equal(client.getCookies()["asst_session"], "jwt-token-here");
  assert.equal(client.getSessionToken(), "jwt-token-here");
});

test("client networks error becomes BAD_GATEWAY status=0", async () => {
  const fakeFetch = makeFakeFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  const client = new AresClient({ baseUrl: "http://x.test", fetchImpl: fakeFetch });
  await assert.rejects(client.me(), (e: unknown) => {
    assert.ok(e instanceof AresApiError);
    assert.equal(e.code, "BAD_GATEWAY");
    assert.equal(e.status, 0);
    return true;
  });
});
