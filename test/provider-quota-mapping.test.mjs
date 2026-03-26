import test from "node:test";
import assert from "node:assert/strict";

import { mapCodexQuotaPayload } from "../dist-backend/providers/codex/codex-quota.js";
import { mapCursorCurrentPlanQuota } from "../dist-backend/providers/cursor/cursor-quota.js";

test("maps Codex live quota payload into primary, weekly, and review meters", () => {
  const now = new Date("2026-03-25T00:00:00.000Z");
  const snapshot = mapCodexQuotaPayload(
    {
      plan_type: "Plus",
      rate_limit: {
        primary_window: {
          used_percent: 45,
          reset_at: 1_774_424_400,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 62,
          reset_at: 1_774_683_600,
          limit_window_seconds: 604_800,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 10,
          reset_at: 1_774_424_400,
          limit_window_seconds: 18_000,
        },
      },
      additional_rate_limits: [
        {
          limit_name: "GPT-5-Codex-Research",
          rate_limit: {
            primary_window: {
              used_percent: 33,
              reset_at: 1_774_424_400,
              limit_window_seconds: 18_000,
            },
          },
        },
      ],
    },
    now,
    undefined,
  );

  assert.equal(snapshot.quotaStatus, "available");
  assert.equal(snapshot.quotaStatusMessage, "Codex Plus live quota");
  assert.deepEqual(
    snapshot.quotaMeters.map((meter) => [meter.label, meter.displayMode]),
    [
      ["Session (5h)", "remaining"],
      ["Weekly", "remaining"],
      ["Reviews", "remaining"],
      ["Research", "remaining"],
    ],
  );
});

test("maps Cursor current-plan payload into provider-native live meters", () => {
  const now = new Date("2026-03-25T00:00:00.000Z");
  const snapshot = mapCursorCurrentPlanQuota(
    {
      billingCycleStart: "2026-03-01T00:00:00.000Z",
      billingCycleEnd: "2026-04-01T00:00:00.000Z",
      membershipType: "pro",
      limitType: "user",
      individualUsage: {
        plan: {
          enabled: true,
          used: 42,
          remaining: 58,
          limit: 100,
          totalPercentUsed: 42,
          autoPercentUsed: 25,
          apiPercentUsed: 17,
        },
        onDemand: {
          enabled: true,
          used: 1500,
          remaining: 3500,
          limit: 5000,
        },
      },
    },
    now,
  );

  assert.equal(snapshot.quotaStatus, "available");
  assert.equal(snapshot.quotaStatusMessage, "Cursor pro");
  assert.deepEqual(
    snapshot.quotaMeters.map((meter) => [meter.label, meter.kind]),
    [
      ["Total usage", "percent"],
      ["Auto usage", "percent"],
      ["API usage", "percent"],
      ["On-demand", "currency"],
    ],
  );
});
