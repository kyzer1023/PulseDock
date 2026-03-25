import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { buildProviderSnapshot } from "../shared/provider-snapshot.js";
import { collectCursorCost } from "./cursor-cost.js";
import { fetchCursorQuota } from "./cursor-quota.js";

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const [costSnapshot, quotaSnapshot] = await Promise.all([
      collectCursorCost(
        context.now,
        context.previousSnapshot,
        context.selectedUsageRange,
        context.forceRefresh,
      ),
      fetchCursorQuota(context.now, context.previousSnapshot),
    ]);
    return buildProviderSnapshot({
      id: "cursor",
      displayName: "Cursor",
      activityLabel: "Active days",
      quotaProvenanceLabel: "Cursor live quota",
      context,
      costSnapshot,
      quotaSnapshot,
      usageWindow: costSnapshot.usageWindow,
    });
  },
};
