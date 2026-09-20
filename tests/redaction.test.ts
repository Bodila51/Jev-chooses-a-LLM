import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, taskDigest, containsSecret } from "../shared/redaction.js";

describe("redaction", () => {
  it("redacts bearer tokens and emails", () => {
    const s = redactSecrets("Authorization: Bearer abcdefghijklmnop AND user@example.com");
    assert.match(s, /REDACTED:bearer/);
    assert.match(s, /REDACTED:email/);
    assert.equal(s.includes("user@example.com"), false);
  });

  it("redacts typesafe apikey_ prefix", () => {
    const out = redactSecrets("token=apikey_TESTONLY_NOT_A_REAL_SECRET_xxx");
    assert.match(out, /REDACTED:typesafe_apikey/);
    assert.equal(containsSecret("apikey_TESTONLY_NOT_A_REAL_SECRET_xxx"), true);
  });

  it("redacts github and openai style keys", () => {
    const s = redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz1234 and sk-abcdefghijklmnopqrstuvwxyz");
    assert.match(s, /REDACTED/);
  });

  it("taskDigest hides content by default", () => {
    const d = taskDigest("secret prompt with password", false);
    assert.match(d, /^len=\d+;fp=/);
    assert.equal(d.includes("password"), false);
  });

  it("taskDigest can include redacted content when enabled", () => {
    const d = taskDigest("hello world user@x.com", true);
    assert.match(d, /hello world/);
    assert.match(d, /REDACTED:email/);
  });

  it("containsSecret detects jwt-like", () => {
    assert.equal(
      containsSecret("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"),
      true,
    );
  });
});
