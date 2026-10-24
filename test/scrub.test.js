import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_TYPES, scrub, scrubDeep, scrubWithReport } from "../src/scrub.js";
import { FAKE } from "./helpers/fixtures.js";

const PEM = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAfakefakefake", "abc123==", "-----END RSA PRIVATE KEY-----"].join("\n");

const CASES = [
  ["openai_key", `key ${FAKE.OPENAI_KEY} here`],
  ["openai_key", `plain ${["sk", "Abcdefghij0123456789KLMNOP"].join("-")}`],
  ["anthropic_key", `use ${FAKE.ANTHROPIC_KEY}`],
  ["seed_key", `my key ${FAKE.SEED_KEY}`],
  ["aws_access_key", `aws ${FAKE.AWS_KEY} ok`],
  ["github_token", `gh ${FAKE.GITHUB_TOKEN}`],
  ["github_token", `pat ${["github", "pat", "11ABCDEFG0123456789_abcdefghijk"].join("_")}`],
  ["slack_token", `slack ${FAKE.SLACK_TOKEN}`],
  ["google_api_key", `g ${FAKE.GOOGLE_KEY}`],
  ["stripe_key", `stripe ${FAKE.STRIPE_KEY}`],
  ["stripe_key", `restricted ${["rk", "test", "FakeRestricted0123456"].join("_")}`],
  ["telegram_bot_token", `bot ${FAKE.TG_TOKEN}`],
  ["jwt", `jwt ${FAKE.JWT}`],
  ["private_key", `pem:\n${PEM}\nend`],
  ["url_credentials", `db postgres://admin:${FAKE.DB_PASS}@db.internal:5432/app`],
];

for (const [type, input] of CASES) {
  test(`redacts ${type}: ${input.slice(0, 24)}…`, () => {
    const { text, redactions } = scrubWithReport(input);
    assert.ok(text.includes(`[REDACTED:${type}]`), `expected ${type} marker in: ${text}`);
    assert.ok(redactions[type] >= 1);
    for (const secret of Object.values(FAKE)) assert.ok(!text.includes(secret), `leaked ${secret}`);
  });
}

test("url credentials keep scheme and host", () => {
  assert.equal(scrub(`mongodb+srv://bob:${FAKE.DB_PASS}@cluster0.example.net/db`), "mongodb+srv://[REDACTED:url_credentials]@cluster0.example.net/db");
});

test("generic assignments keep the key name", () => {
  assert.equal(scrub("api_key = 'abcd1234efgh'"), "api_key = '[REDACTED:secret]'");
  assert.equal(scrub('"password": "hunter2hunter2"'), '"password": "[REDACTED:secret]"');
  assert.equal(scrub("DB_PASSWD=correcthorse"), "DB_PASSWD=[REDACTED:secret]");
  assert.equal(scrub("client_secret: s3cr3tvalue99"), "client_secret: [REDACTED:secret]");
  assert.equal(scrub("ACCESS_TOKEN=abcdefgh12345678"), "ACCESS_TOKEN=[REDACTED:secret]");
});

test("specific types win over the generic rule (no double redaction)", () => {
  assert.equal(scrub(`OPENAI_API_KEY=${FAKE.OPENAI_KEY}`), "OPENAI_API_KEY=[REDACTED:openai_key]");
  assert.equal(scrub(`SEED_API_KEY="${FAKE.SEED_KEY}"`), 'SEED_API_KEY="[REDACTED:seed_key]"');
});

test("bearer tokens", () => {
  assert.equal(scrub("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"), "Authorization: Bearer [REDACTED:bearer_token]");
});

test("leaves ordinary text alone", () => {
  const safe = [
    "Always use pnpm instead of npm.",
    "task-abcdefghijklmnopqrstuvwxyz is a ticket id",
    "the seed_protocol_mcp_server module",
    "token: short",
    "max tokens = 4096",
    "Visit https://seed.abhibots.com/login to get started",
    "git@github.com:AbhiWisdom/seed-protocol-mcp.git",
    "Hinglish mein reply karo",
  ];
  for (const s of safe) assert.equal(scrub(s), s);
});

test("idempotent: scrubbing twice changes nothing more", () => {
  const once = scrub(`k=${FAKE.ANTHROPIC_KEY} password=${FAKE.DB_PASS}1`);
  assert.equal(scrub(once), once);
});

test("scrubDeep walks objects and arrays, passes non-strings", () => {
  const out = scrubDeep({ a: [FAKE.GITHUB_TOKEN, 3, null], b: { c: `x ${FAKE.JWT}` }, d: true });
  assert.deepEqual(out, { a: ["[REDACTED:github_token]", 3, null], b: { c: "x [REDACTED:jwt]" }, d: true });
  assert.equal(scrub(undefined), undefined);
  assert.equal(scrub(""), "");
});

test("covers every required secret type", () => {
  for (const t of ["openai_key", "anthropic_key", "seed_key", "aws_access_key", "github_token", "slack_token", "google_api_key", "stripe_key", "telegram_bot_token", "jwt", "private_key", "url_credentials", "secret"]) {
    assert.ok(SECRET_TYPES.includes(t), t);
  }
});

test("generic service keys (prefix_longtoken) are redacted, snake_case prose is not", () => {
  const nano = ["nb", "_", "7f09cc7dd083384b755f7ab7d9043dc0"].join("");
  const live = ["abhi", "_live_", "A1b2C3d4E5f6G7h8J9k0L1m2N3p4"].join("");
  assert.equal(scrub(`key ${nano} here`), "key [REDACTED:api_key] here");
  assert.equal(scrub(live), "[REDACTED:api_key]");
  for (const ok of ["memory_search_enabled", "use_memory_search_when_offline_always", "snake_case_identifier_without_digits_here"]) assert.equal(scrub(ok), ok);
});
