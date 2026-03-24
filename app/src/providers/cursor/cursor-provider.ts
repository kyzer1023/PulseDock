import {
  aggregateSummaryByModel,
  aggregateSummaryByProvider,
  calculateTotals,
  hasRowUsage,
} from "cstats/dist/src/aggregate.js";
import { downloadUsageCsv, parseUsageCsv } from "cstats/dist/src/cursor-export.js";
import { toEpochRange } from "cstats/dist/src/date-range.js";
import { getUnpricedModels } from "cstats/dist/src/pricing.js";
import type { DateRange, UsageRow } from "cstats/dist/src/types.js";
import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import { summarizeUnknownModels } from "../shared/warning-text.js";

function getActiveDayCount(rows: UsageRow[]): number {
  return new Set(rows.map((row) => row.date)).size;
}

function toDisplayLabel(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createDateRange(window: ReturnType<typeof createRecentDateWindow>): DateRange {
  return {
    since: window.cursorSince,
    until: window.cursorUntil,
  };
}

function createEmptySnapshot(
  context: ProviderContext,
  detailMessage: string,
): ProviderSnapshot {
  const window = createRecentDateWindow(context.now);

  return {
    id: "cursor",
    displayName: "Cursor",
    status: "empty",
    usageWindow: window.usageWindow,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "provider",
    activityCount: 0,
    activityLabel: "Active days",
    warnings: [],
    lastRefreshedAt: context.now.toISOString(),
    staleSince: null,
    provenance: ["Cursor desktop auth", "Cursor usage export"],
    detailMessage,
  };
}

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const window = createRecentDateWindow(context.now);
    const range = createDateRange(window);
    const csvText = await downloadUsageCsv(toEpochRange(range));
    const parsedRows = parseUsageCsv(csvText, range);
    const usageRows = parsedRows.filter(hasRowUsage);

    if (usageRows.length === 0) {
      return createEmptySnapshot(
        context,
        `No Cursor usage rows were found for ${window.usageWindow.label.toLowerCase()}.`,
      );
    }

    const totals = calculateTotals(usageRows);
    const providerRows = aggregateSummaryByProvider(usageRows, "cost");
    const modelRows = aggregateSummaryByModel(usageRows, "cost");
    const unpricedModels = getUnpricedModels(usageRows);
    const topProvider = providerRows[0]?.provider;
    const topModel = modelRows[0]?.model ?? null;
    const warnings =
      unpricedModels.length > 0 ? [summarizeUnknownModels(unpricedModels)] : [];
    const providerLabel = topProvider ? toDisplayLabel(topProvider) : null;

    return {
      id: "cursor",
      displayName: "Cursor",
      status: warnings.length > 0 ? "warning" : "fresh",
      usageWindow: window.usageWindow,
      inputTokens: totals.inputTokens + totals.cacheCreationTokens,
      cachedInputTokens: totals.cacheReadTokens,
      outputTokens: totals.outputTokens,
      reasoningTokens: 0,
      totalTokens: totals.totalTokens,
      estimatedCost: totals.totalCost,
      topLabel: providerLabel ?? topModel,
      topLabelType: providerLabel ? "provider" : "model",
      activityCount: getActiveDayCount(usageRows),
      activityLabel: "Active days",
      warnings,
      lastRefreshedAt: context.now.toISOString(),
      staleSince: null,
      provenance: ["Cursor desktop auth", "Cursor usage export"],
      detailMessage: null,
    };
  },
};
