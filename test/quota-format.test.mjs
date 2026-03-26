import test from "node:test";
import assert from "node:assert/strict";

import {
  formatQuotaMeterMeta,
  formatQuotaMeterValue,
  getQuotaMeterPercent,
} from "../dist-backend/domain/quota.js";

test("formats percent quota values and clamps percent", () => {
  const meter = {
    id: "session",
    label: "Session (5h)",
    kind: "percent",
    used: 142,
    limit: 100,
    displayMode: "used",
    resetAt: null,
    periodSeconds: 18_000,
    availability: "available",
    sourceLabel: "Codex live quota",
  };

  assert.equal(formatQuotaMeterValue(meter), "142%");
  assert.equal(getQuotaMeterPercent(meter), 100);
  assert.equal(formatQuotaMeterMeta(meter), "Window 5h");
});

test("formats remaining quota meters from used values", () => {
  const meter = {
    id: "weekly",
    label: "Weekly",
    kind: "percent",
    used: 29,
    limit: 100,
    displayMode: "remaining",
    resetAt: null,
    periodSeconds: 604_800,
    availability: "available",
    sourceLabel: "Codex live quota",
  };

  assert.equal(formatQuotaMeterValue(meter), "71%");
  assert.equal(getQuotaMeterPercent(meter), 71);
  assert.equal(formatQuotaMeterMeta(meter), "Window 168h");
});

test("formats count and currency quota values", () => {
  const countMeter = {
    id: "requests",
    label: "Requests",
    kind: "count",
    used: 123,
    limit: 500,
    displayMode: "used",
    unitLabel: "requests",
    resetAt: null,
    periodSeconds: null,
    availability: "available",
    sourceLabel: "Cursor legacy quota",
  };
  const currencyMeter = {
    id: "on-demand",
    label: "On-demand",
    kind: "currency",
    used: 12.5,
    limit: 25,
    displayMode: "used",
    currencyCode: "USD",
    resetAt: null,
    periodSeconds: null,
    availability: "stale",
    sourceLabel: "Cursor live quota",
  };

  assert.equal(formatQuotaMeterValue(countMeter), "123 / 500");
  assert.equal(getQuotaMeterPercent(countMeter), 24.6);
  assert.equal(formatQuotaMeterValue(currencyMeter), "$12.50 / $25.00");
  assert.equal(formatQuotaMeterMeta(currencyMeter), "Showing last known quota");
});

test("reports manual auth requirement in quota meter metadata", () => {
  const meter = {
    id: "legacy",
    label: "Requests",
    kind: "count",
    used: 0,
    limit: 500,
    displayMode: "used",
    unitLabel: "requests",
    resetAt: null,
    periodSeconds: null,
    availability: "manual-required",
    sourceLabel: "Cursor legacy quota",
  };

  assert.equal(formatQuotaMeterMeta(meter), "Manual auth required");
});
