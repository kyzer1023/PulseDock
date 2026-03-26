import type {
  ProviderContext,
  ProviderSnapshot,
  UsageWindow,
} from "../../domain/dashboard.js";

interface ProviderCostLike {
  inputTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
  topLabel: string | null;
  topLabelType: ProviderSnapshot["topLabelType"];
  activityCount: number;
  warnings: string[];
  detailMessage: string | null;
  provenance: string[];
  costStatus: ProviderSnapshot["costStatus"];
  costStatusMessage: string | null;
  costLastRefreshedAt: string | null;
  hasData: boolean;
}

interface ProviderQuotaLike {
  quotaStatus: ProviderSnapshot["quotaStatus"];
  quotaStatusMessage: string | null;
  quotaLastRefreshedAt: string | null;
  quotaMeters: ProviderSnapshot["quotaMeters"];
  warnings: string[];
  hasData: boolean;
}

interface BuildProviderSnapshotOptions {
  activityLabel: string;
  context: ProviderContext;
  costSnapshot: ProviderCostLike;
  displayName: string;
  id: ProviderSnapshot["id"];
  quotaProvenanceLabel: string;
  quotaSnapshot: ProviderQuotaLike;
  usageWindow: UsageWindow;
}

function mergeWarnings(...warningGroups: string[][]): string[] {
  return Array.from(new Set(warningGroups.flatMap((group) => group)));
}

function getProviderStatus(
  costSnapshot: ProviderCostLike,
  quotaSnapshot: ProviderQuotaLike,
  warnings: string[],
): ProviderSnapshot["status"] {
  if (!costSnapshot.hasData && !quotaSnapshot.hasData) {
    return "empty";
  }

  if (
    quotaSnapshot.quotaStatus === "stale" ||
    costSnapshot.costStatus === "stale" ||
    warnings.length > 0
  ) {
    return "warning";
  }

  return "fresh";
}

export function buildProviderSnapshot({
  activityLabel,
  context,
  costSnapshot,
  displayName,
  id,
  quotaProvenanceLabel,
  quotaSnapshot,
  usageWindow,
}: BuildProviderSnapshotOptions): ProviderSnapshot {
  const warnings = mergeWarnings(costSnapshot.warnings, quotaSnapshot.warnings);
  const status = getProviderStatus(costSnapshot, quotaSnapshot, warnings);
  const hasAnyData = costSnapshot.hasData || quotaSnapshot.hasData;
  const nowIso = context.now.toISOString();

  return {
    id,
    displayName,
    status,
    usageWindow,
    inputTokens: costSnapshot.inputTokens,
    cacheWriteTokens: costSnapshot.cacheWriteTokens,
    cachedInputTokens: costSnapshot.cachedInputTokens,
    outputTokens: costSnapshot.outputTokens,
    reasoningTokens: costSnapshot.reasoningTokens,
    totalTokens: costSnapshot.totalTokens,
    estimatedCost: costSnapshot.estimatedCost,
    topLabel: costSnapshot.topLabel,
    topLabelType: costSnapshot.topLabelType,
    activityCount: costSnapshot.activityCount,
    activityLabel,
    warnings,
    lastRefreshedAt: nowIso,
    staleSince: status === "warning" ? nowIso : null,
    provenance: Array.from(new Set([...costSnapshot.provenance, quotaProvenanceLabel])),
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
}
