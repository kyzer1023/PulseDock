import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { collectCodexLocalCost } from "./codex-local-cost.js";
import { fetchCodexQuota } from "./codex-quota.js";

function combineWarnings(...warningGroups: string[][]): string[] {
  return Array.from(new Set(warningGroups.flatMap((group) => group)));
}

export const codexProvider: UsageProvider = {
  id: "codex",
  displayName: "Codex",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const [costSnapshot, quotaSnapshot] = await Promise.all([
      collectCodexLocalCost(context.now, context.previousSnapshot),
      fetchCodexQuota(context.now, context.previousSnapshot),
    ]);

    const hasAnyData = costSnapshot.hasData || quotaSnapshot.hasData;
    const warnings = combineWarnings(costSnapshot.warnings, quotaSnapshot.warnings);
    const status: ProviderSnapshot["status"] = !hasAnyData
      ? "empty"
      : quotaSnapshot.quotaStatus === "stale" || costSnapshot.costStatus === "stale" || warnings.length > 0
        ? "warning"
        : "fresh";

    return {
      id: "codex",
      displayName: "Codex",
      status,
      usageWindow: {
        label: "Last 7 days",
        since: new Date(context.now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        until: context.now.toISOString(),
      },
      inputTokens: costSnapshot.inputTokens,
      cachedInputTokens: costSnapshot.cachedInputTokens,
      outputTokens: costSnapshot.outputTokens,
      reasoningTokens: costSnapshot.reasoningTokens,
      totalTokens: costSnapshot.totalTokens,
      estimatedCost: costSnapshot.estimatedCost,
      topLabel: costSnapshot.topLabel,
      topLabelType: costSnapshot.topLabelType,
      activityCount: costSnapshot.activityCount,
      activityLabel: "Sessions",
      warnings,
      lastRefreshedAt: context.now.toISOString(),
      staleSince: status === "warning" ? context.now.toISOString() : null,
      provenance: Array.from(new Set([...costSnapshot.provenance, "Codex live quota"])),
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
