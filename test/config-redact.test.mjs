import { test } from "node:test";
import assert from "node:assert/strict";

import { redactConfig } from "../src/config/redact.mjs";

test("redactConfig masks wpAppPassword and wpBearerToken", () => {
  const input = {
    wpUser: "editor",
    wpAppPassword: "super-secret-abcd-1234",
    wpBearerToken: "eyJhbGciOi...",
    wpBaseUrl: "https://example.com"
  };
  const out = redactConfig(input);
  assert.equal(out.wpUser, "editor");
  assert.equal(out.wpAppPassword, "[REDACTED]");
  assert.equal(out.wpBearerToken, "[REDACTED]");
  assert.equal(out.wpBaseUrl, "https://example.com");
});

test("redactConfig preserves empty strings on secret keys (nothing to hide)", () => {
  const out = redactConfig({ wpAppPassword: "", wpBearerToken: "" });
  assert.equal(out.wpAppPassword, "");
  assert.equal(out.wpBearerToken, "");
});

test("redactConfig masks keys that match the secret pattern", () => {
  const out = redactConfig({
    apiToken: "abc",
    userPassword: "pw",
    someSecret: "s",
    credentialFile: "/etc/creds",
    normalField: "ok"
  });
  assert.equal(out.apiToken, "[REDACTED]");
  assert.equal(out.userPassword, "[REDACTED]");
  assert.equal(out.someSecret, "[REDACTED]");
  assert.equal(out.credentialFile, "[REDACTED]");
  assert.equal(out.normalField, "ok");
});

test("redactConfig walks nested objects", () => {
  const out = redactConfig({
    outer: {
      wpAppPassword: "inner-secret",
      keep: "yes"
    }
  });
  assert.equal(out.outer.wpAppPassword, "[REDACTED]");
  assert.equal(out.outer.keep, "yes");
});

test("redactConfig walks arrays", () => {
  const out = redactConfig({
    items: [
      { wpAppPassword: "s1", name: "one" },
      { wpAppPassword: "s2", name: "two" }
    ]
  });
  assert.equal(out.items[0].wpAppPassword, "[REDACTED]");
  assert.equal(out.items[0].name, "one");
  assert.equal(out.items[1].wpAppPassword, "[REDACTED]");
});

test("redactConfig returns primitives unchanged", () => {
  assert.equal(redactConfig(null), null);
  assert.equal(redactConfig("plain string"), "plain string");
  assert.equal(redactConfig(42), 42);
});

test("redactConfig does not mutate input", () => {
  const input = { wpAppPassword: "orig" };
  const out = redactConfig(input);
  assert.equal(input.wpAppPassword, "orig");
  assert.equal(out.wpAppPassword, "[REDACTED]");
  assert.notEqual(out, input);
});
