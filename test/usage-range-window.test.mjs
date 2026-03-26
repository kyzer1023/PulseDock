import test from "node:test";
import assert from "node:assert/strict";

import { createUsageDateWindow } from "../dist-backend/providers/shared/date-window.js";

test("builds trailing local windows for today, week, month, and all time", () => {
  const now = new Date(2026, 2, 25, 18, 30, 0, 0);

  const today = createUsageDateWindow(now, "today");
  assert.equal(today.usageWindow.label, "Today");
  assert.equal(today.codexSince, "2026-03-25");
  assert.equal(today.cursorSince, "20260325");

  const week = createUsageDateWindow(now, "week");
  assert.equal(week.usageWindow.label, "Last 7 days");
  assert.equal(week.codexSince, "2026-03-19");
  assert.equal(week.cursorSince, "20260319");

  const month = createUsageDateWindow(now, "month");
  assert.equal(month.usageWindow.label, "Last 30 days");
  assert.equal(month.codexSince, "2026-02-24");
  assert.equal(month.cursorSince, "20260224");

  const all = createUsageDateWindow(now, "all", {
    earliestAvailableAt: new Date(2026, 0, 5, 9, 0, 0, 0),
  });
  assert.equal(all.usageWindow.label, "All time");
  assert.equal(all.codexSince, "2026-01-05");
  assert.equal(all.cursorSince, "20260105");
  assert.equal(all.codexUntil, "2026-03-25");
  assert.equal(all.cursorUntil, "20260325");
});
