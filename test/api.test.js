import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ApiError, createApi, withRateLimitRetry } from "../src/api.js";
import { VERSION } from "../src/config.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";

test("sends X-Api-Key, caches /me, resolves the soul id", async () => {
  const mock = await startMockApi();
  try {
    const api = createApi({ apiUrl: mock.url, apiKey: TEST_KEY });
    assert.equal(await api.seedId(), SOUL_ID);
    assert.equal(await api.seedId(), SOUL_ID);
    await api.get("/state");
    await api.post("/remember", { content: "x", category: "general", importance: 0.5 });
    assert.equal(mock.requests.filter((r) => r.path === "/api/v1/me").length, 1);
    for (const r of mock.requests) assert.equal(r.headers["x-api-key"], TEST_KEY);
    const post = mock.requests.find((r) => r.method === "POST");
    assert.equal(post.headers["content-type"], "application/json");
    assert.equal(post.headers["user-agent"], `seed-protocol-mcp/${VERSION}`);
  } finally {
    await mock.close();
  }
});

test("NO_SOUL with a clear next step, not cached", async () => {
  const mock = await startMockApi({ soul: null });
  try {
    const api = createApi({ apiUrl: mock.url, apiKey: TEST_KEY });
    await assert.rejects(api.seedId(), (e) => e.code === "NO_SOUL" && e.message === "No soul yet — create one at https://seed.abhibots.com/login");
    await assert.rejects(api.seedId(), (e) => e.code === "NO_SOUL");
    assert.equal(mock.requests.filter((r) => r.path === "/api/v1/me").length, 2);
  } finally {
    await mock.close();
  }
});

test("NO_KEY without any request", async () => {
  const api = createApi({ apiUrl: "http://127.0.0.1:9", apiKey: "" });
  await assert.rejects(api.seedId(), (e) => e.code === "NO_KEY" && /seed\.abhibots\.com\/login/.test(e.message));
});

test("maps 401 / 404 / 410 / 429 / 5xx / validation detail", async () => {
  const replies = {
    "/401": [401, { detail: "Invalid API key" }],
    "/404": [404, { detail: "Soul not found" }],
    "/410": [410, { detail: "Gone" }],
    "/429": [429, { detail: "slow down" }, { "Retry-After": "7" }],
    "/500": [502, { detail: "bad gateway" }],
    "/422": [422, { detail: [{ loc: ["body", "summary"], msg: "field required" }] }],
  };
  const server = createServer((req, res) => {
    const [status, body, headers = {}] = replies[req.url];
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = createApi({ apiUrl: `http://127.0.0.1:${server.address().port}`, apiKey: TEST_KEY });
  try {
    const codeOf = async (p) => api.request(p).then(() => null, (e) => e);
    assert.equal((await codeOf("/401")).code, "UNAUTHORIZED");
    assert.match((await codeOf("/401")).message, /seed\.abhibots\.com\/login/);
    assert.equal((await codeOf("/404")).code, "NOT_FOUND");
    assert.equal((await codeOf("/410")).code, "GONE");
    const rl = await codeOf("/429");
    assert.equal(rl.code, "RATE_LIMITED");
    assert.equal(rl.retryAfter, 7);
    assert.equal((await codeOf("/500")).code, "UPSTREAM_ERROR");
    assert.match((await codeOf("/422")).message, /summary: field required/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("times out instead of hanging", async () => {
  const server = createServer(() => {}); // never answers
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = createApi({ apiUrl: `http://127.0.0.1:${server.address().port}`, apiKey: TEST_KEY, timeoutMs: 150 });
  try {
    await assert.rejects(api.request("/slow"), (e) => e.code === "TIMEOUT");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test("network errors are reported as NETWORK", async () => {
  const api = createApi({ apiUrl: "http://127.0.0.1:9", apiKey: TEST_KEY, timeoutMs: 2000 });
  await assert.rejects(api.request("/x"), (e) => e.code === "NETWORK" || e.code === "TIMEOUT");
});

test("withRateLimitRetry honours Retry-After and gives up on other errors", async () => {
  const waits = [];
  let calls = 0;
  const value = await withRateLimitRetry(
    async () => {
      calls++;
      if (calls < 3) throw new ApiError("RATE_LIMITED", "429", { retryAfter: calls });
      return "ok";
    },
    { sleep: async (ms) => waits.push(ms) },
  );
  assert.equal(value, "ok");
  assert.deepEqual(waits, [1000, 2000]);
  await assert.rejects(withRateLimitRetry(async () => { throw new ApiError("BAD_REQUEST", "x"); }, { sleep: async () => {} }), (e) => e.code === "BAD_REQUEST");
  await assert.rejects(
    withRateLimitRetry(async () => { throw new ApiError("RATE_LIMITED", "x"); }, { retries: 2, sleep: async () => {} }),
    (e) => e.code === "RATE_LIMITED",
  );
});
