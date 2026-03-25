import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { collectCodexLocalCost } from "./codex-local-cost.js";
import { fetchCodexQuota } from "./codex-quota.js";
import { buildProviderSnapshot } from "../shared/provider-snapshot.js";

export const codexProvider: UsageProvider = {
  id: "codex",
  displayName: "Codex",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const [costSnapshot, quotaSnapshot] = await Promise.all([
      collectCodexLocalCost(
        context.now,
        context.previousSnapshot,
        context.selectedUsageRange,
        context.forceRefresh,
      ),
      fetchCodexQuota(context.now, context.previousSnapshot),
    ]);

    return buildProviderSnapshot({
      id: "codex",
      displayName: "Codex",
      activityLabel: "Sessions",
      quotaProvenanceLabel: "Codex live quota",
      context,
      costSnapshot,
      quotaSnapshot,
      usageWindow: costSnapshot.usageWindow,
    });
  },
};
