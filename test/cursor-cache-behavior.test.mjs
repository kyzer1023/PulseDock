import test from "node:test";
import assert from "node:assert/strict";

import { getCursorCacheDisposition } from "../dist-backend/providers/cursor/cursor-cost.js";

test("reuses wider cached Cursor ranges and widens on demand", () => {
  assert.deepEqual(getCursorCacheDisposition("week", "today", false), {
    shouldReuse: true,
    fetchRange: "week",
  });
  assert.deepEqual(getCursorCacheDisposition("week", "month", false), {
    shouldReuse: false,
    fetchRange: "month",
  });
  assert.deepEqual(getCursorCacheDisposition("month", "all", false), {
    shouldReuse: false,
    fetchRange: "all",
  });
  assert.deepEqual(getCursorCacheDisposition("all", "today", false), {
    shouldReuse: true,
    fetchRange: "all",
  });
  assert.deepEqual(getCursorCacheDisposition("all", "month", true), {
    shouldReuse: false,
    fetchRange: "month",
  });
});
