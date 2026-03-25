import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import { collectCursorCost } from "./cursor-cost.js";
import { fetchCursorQuota } from "./cursor-quota.js";

function combineWarnings(...warningGroups: string[][]): string[] {
  return Array.from(new Set(warningGroups.flatMap((group) => group)));
}

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const [costSnapshot, quotaSnapshot] = await Promise.all([
      collectCursorCost(context.now, context.previousSnapshot),
      fetchCursorQuota(context.now, context.previousSnapshot),
    ]);
    const usageWindow = createRecentDateWindow(context.now).usageWindow;
    const hasAnyData = costSnapshot.hasData || quotaSnapshot.hasData;
    const warnings = combineWarnings(costSnapshot.warnings, quotaSnapshot.warnings);
    const status: ProviderSnapshot["status"] = !hasAnyData
      ? "empty"
      : quotaSnapshot.quotaStatus === "stale" || costSnapshot.costStatus === "stale" || warnings.length > 0
        ? "warning"
        : "fresh";

    return {
      id: "cursor",
      displayName: "Cursor",
      status,
      usageWindow,
      inputTokens: costSnapshot.inputTokens,
      cachedInputTokens: costSnapshot.cachedInputTokens,
      outputTokens: costSnapshot.outputTokens,
      reasoningTokens: costSnapshot.reasoningTokens,
      totalTokens: costSnapshot.totalTokens,
      estimatedCost: costSnapshot.estimatedCost,
      topLabel: costSnapshot.topLabel,
      topLabelType: costSnapshot.topLabelType,
      activityCount: costSnapshot.activityCount,
      activityLabel: "Active days",
      warnings,
      lastRefreshedAt: context.now.toISOString(),
      staleSince: status === "warning" ? context.now.toISOString() : null,
      provenance: Array.from(new Set([...costSnapshot.provenance, "Cursor live quota"])),
      detailMessage: hasAnyData
        ? quotaSnapshot.quotaStatusMessage ?? costSnapshot.costStatusMessage
        : costSnapshot.detailMessage ?? quotaSnapshot.quotaStatusMessage,
      quotaStatus: quotaSnapshot.quotaStatus,
      quotaStatusMessage: quotaSnapshot.quotaStatusMessage,
      quotaLastRefreshedAt: quotaSnapshot.quotaLastRefreshedAt,
      costStatus: costSnapshot.costStatus,
      costStatusMessage: costSnapshot.costStatusMessage,
      costLastRefreshedAt: costSnapshot.costLastRefreshedAt,
      quotaMeters: quotaSnapshot.quotaMeters,
    };
  },
};
