import test from "node:test";
import assert from "node:assert/strict";

import { assertAllowedExternalUrl } from "../dist-electron/src/domain/external-url.js";

test("allows only known https dashboard hosts", () => {
  assert.equal(
    assertAllowedExternalUrl("https://cursor.com/settings"),
    "https://cursor.com/settings",
  );
  assert.equal(
    assertAllowedExternalUrl("https://chatgpt.com/backend-api/wham/usage"),
    "https://chatgpt.com/backend-api/wham/usage",
  );
});

test("blocks non-https and unknown external URLs", () => {
  assert.throws(() => assertAllowedExternalUrl("http://cursor.com/settings"), /Blocked external URL/);
  assert.throws(() => assertAllowedExternalUrl("https://evil.example.com"), /Blocked external URL/);
});
