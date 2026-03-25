import test from "node:test";
import assert from "node:assert/strict";

import { ProviderOrchestrator } from "../dist-electron/src/application/provider-orchestrator.js";

function makeSnapshot(overrides = {}) {
  return {
    id: "codex",
    displayName: "Codex",
    status: "fresh",
    usageWindow: {
      label: "Last 7 days",
      since: "2026-03-18T00:00:00.000Z",
      until: "2026-03-25T00:00:00.000Z",
    },
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 80,
    reasoningTokens: 10,
    totalTokens: 210,
    estimatedCost: 1.23,
    topLabel: "gpt-5-codex",
    topLabelType: "model",
    activityCount: 3,
    activityLabel: "Sessions",
    warnings: [],
    lastRefreshedAt: "2026-03-25T00:00:00.000Z",
    staleSince: null,
    provenance: ["Local Codex sessions", "Codex live quota"],
    detailMessage: null,
    quotaStatus: "available",
    quotaStatusMessage: null,
    quotaLastRefreshedAt: "2026-03-25T00:00:00.000Z",
    costStatus: "available",
    costStatusMessage: null,
    costLastRefreshedAt: "2026-03-25T00:00:00.000Z",
    quotaMeters: [
      {
        id: "session",
        label: "Session (5h)",
        kind: "percent",
        used: 40,
        limit: 100,
        resetAt: "2026-03-25T05:00:00.000Z",
        periodSeconds: 18_000,
        availability: "available",
        sourceLabel: "Codex live quota",
      },
    ],
    ...overrides,
  };
}

test("preserves last known provider data as stale when the collector fails", async () => {
  const collector = {
    calls: 0,
    async collect() {
      this.calls += 1;
      if (this.calls === 1) {
        return [{ id: "codex", ok: true, snapshot: makeSnapshot() }];
      }

      return [{ id: "codex", ok: false, errorMessage: "quota endpoint timed out" }];
    },
  };

  const orchestrator = new ProviderOrchestrator([{ id: "codex", displayName: "Codex" }], collector);

  const initial = await orchestrator.refresh();
  assert.equal(initial.providers[0].status, "fresh");
  assert.equal(initial.providers[0].quotaStatus, "available");
  assert.equal(initial.providers[0].costStatus, "available");

  const stale = await orchestrator.refresh();
  assert.equal(stale.providers[0].status, "stale");
  assert.equal(stale.providers[0].quotaStatus, "stale");
  assert.equal(stale.providers[0].costStatus, "stale");
  assert.match(stale.providers[0].detailMessage ?? "", /timed out/);
  assert.deepEqual(stale.providers[0].quotaMeters.map((meter) => meter.id), ["session"]);
});
