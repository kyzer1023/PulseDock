import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import { buildProviderSnapshot } from "../shared/provider-snapshot.js";
import { collectCursorCost } from "./cursor-cost.js";
import { fetchCursorQuota } from "./cursor-quota.js";

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const [costSnapshot, quotaSnapshot] = await Promise.all([
      collectCursorCost(context.now, context.previousSnapshot),
      fetchCursorQuota(context.now, context.previousSnapshot),
    ]);
    const usageWindow = createRecentDateWindow(context.now).usageWindow;
    return buildProviderSnapshot({
      id: "cursor",
      displayName: "Cursor",
      activityLabel: "Active days",
      quotaProvenanceLabel: "Cursor live quota",
      context,
      costSnapshot,
      quotaSnapshot,
      usageWindow,
    });
  },
};
