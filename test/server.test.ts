import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";

async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const server = createApp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const post = (url: string, path: string, body: unknown) =>
  fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("the page is served as HTML", async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /Crucible/);
  });
});

test("evaluates an expression with a context", async () => {
  await withServer(async (url) => {
    const res = await post(url, "/evaluate", { source: "2 + 3 * 4" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, value: 14 });

    const contextual = await post(url, "/evaluate", { source: "total > 100 && vip", env: { total: 150, vip: true } });
    assert.deepEqual(await contextual.json(), { ok: true, value: true });
  });
});

test("reports the position of a syntax error", async () => {
  await withServer(async (url) => {
    const res = await post(url, "/evaluate", { source: "1 + * 2" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error.position, "number");
    assert.ok(body.error.message.length > 0);
  });
});

test("tokenises an expression", async () => {
  await withServer(async (url) => {
    const res = await post(url, "/tokens", { source: "1 + 2" });
    assert.equal(res.status, 200);
    const { tokens } = await res.json();
    assert.deepEqual(tokens.map((token: { type: string }) => token.type), ["number", "operator", "number", "eof"]);
  });
});

test("rejects a body that is not JSON", async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    assert.equal(res.status, 400);
  });
});
