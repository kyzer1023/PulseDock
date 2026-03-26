import test from "node:test";
import assert from "node:assert/strict";

import { getCursorRowTokenBreakdown } from "../dist-backend/providers/cursor/cursor-cost.js";
import { mapCodexWarnings } from "../dist-backend/providers/shared/warning-text.js";

test("counts Cursor cache reads inside inputTokens so usage meters sum correctly", () => {
  const breakdown = getCursorRowTokenBreakdown({
    inputWithCacheWrite: 200,
    inputWithoutCacheWrite: 100,
    cacheRead: 900,
    outputTokens: 50,
  });

  assert.deepEqual(breakdown, {
    inputTokens: 100,
    cacheWriteTokens: 100,
    cachedInputTokens: 900,
    outputTokens: 50,
    totalTokens: 1150,
  });

  assert.equal(
    breakdown.inputTokens +
      breakdown.cacheWriteTokens +
      breakdown.cachedInputTokens +
      breakdown.outputTokens,
    breakdown.totalTokens,
  );
});

test("suppresses unmeasurable Codex session warnings from the UI warning list", () => {
  assert.deepEqual(mapCodexWarnings(["unmeasurable-session"]), []);
});
