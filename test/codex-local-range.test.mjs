import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectCodexLocalCost,
  formatCodexLocalDateKey,
  resetCodexLocalCostCacheForTests,
} from "../dist-backend/providers/codex/codex-local-cost.js";

function makeEventLine(timestamp, usage, source = "cli") {
  return [
    JSON.stringify({ type: "session_meta", payload: { source } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-codex" } }),
    JSON.stringify({
      type: "token_count",
      timestamp,
      info: {
        model: "gpt-5-codex",
        last_token_usage: usage,
      },
    }),
  ].join("\n");
}

async function writeSession(rootDir, sessionName, timestamp, usage) {
  const sessionDir = path.join(rootDir, "sessions", sessionName);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionDir, `rollout-${sessionName}.jsonl`),
    `${makeEventLine(timestamp, usage)}\n`,
    "utf8",
  );
}

test("slices Codex local usage into today, week, month, and all time", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulsedock-codex-range-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const now = new Date(2026, 2, 25, 18, 0, 0, 0);

  try {
    await writeSession(tempDir, "today", new Date(2026, 2, 25, 12, 0, 0, 0).toISOString(), {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 10,
      total_tokens: 160,
    });
    await writeSession(tempDir, "week", new Date(2026, 2, 21, 12, 0, 0, 0).toISOString(), {
      input_tokens: 60,
      cached_input_tokens: 10,
      output_tokens: 20,
      reasoning_output_tokens: 0,
      total_tokens: 90,
    });
    await writeSession(tempDir, "all", new Date(2026, 1, 20, 12, 0, 0, 0).toISOString(), {
      input_tokens: 40,
      cached_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 50,
    });

    process.env.CODEX_HOME = tempDir;
    resetCodexLocalCostCacheForTests();

    const weekSnapshot = await collectCodexLocalCost(now, undefined, "week", true);
    assert.equal(weekSnapshot.totalTokens, 250);
    assert.equal(weekSnapshot.activityCount, 2);
    assert.equal(weekSnapshot.usageWindow.label, "Last 7 days");

    const todaySnapshot = await collectCodexLocalCost(now, undefined, "today", false);
    assert.equal(todaySnapshot.totalTokens, 160);
    assert.equal(todaySnapshot.activityCount, 1);
    assert.equal(todaySnapshot.usageWindow.label, "Today");

    const monthSnapshot = await collectCodexLocalCost(now, undefined, "month", false);
    assert.equal(monthSnapshot.totalTokens, 250);
    assert.equal(monthSnapshot.activityCount, 2);
    assert.equal(monthSnapshot.usageWindow.label, "Last 30 days");

    const allSnapshot = await collectCodexLocalCost(now, undefined, "all", false);
    assert.equal(allSnapshot.totalTokens, 300);
    assert.equal(allSnapshot.activityCount, 3);
    assert.equal(allSnapshot.usageWindow.label, "All time");
    const allTimeSince = new Date(allSnapshot.usageWindow.since);
    assert.equal(allTimeSince.getFullYear(), 2026);
    assert.equal(allTimeSince.getMonth(), 1);
    assert.equal(allTimeSince.getDate(), 20);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    resetCodexLocalCostCacheForTests();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("formats Codex local date keys without depending on locale-formatted output", () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;

  class MockDateTimeFormat {
    constructor(locales, options = {}) {
      this.delegate = new RealDateTimeFormat(locales, options);
      this.options = options;
    }

    resolvedOptions() {
      return {
        ...this.delegate.resolvedOptions(),
        timeZone: this.options.timeZone ?? "UTC",
      };
    }

    format(date) {
      return "3/26/2026";
    }

    formatToParts(date) {
      return [
        { type: "month", value: "03" },
        { type: "literal", value: "/" },
        { type: "day", value: "26" },
        { type: "literal", value: "/" },
        { type: "year", value: "2026" },
      ];
    }
  }

  Intl.DateTimeFormat = MockDateTimeFormat;

  try {
    assert.equal(
      formatCodexLocalDateKey("2026-03-26T14:52:31.172Z", "Asia/Kuala_Lumpur"),
      "2026-03-26",
    );
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});
