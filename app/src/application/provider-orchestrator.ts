import { EventEmitter } from "node:events";
import type {
  DashboardNotice,
  DashboardSnapshot,
  DashboardSummary,
  ProviderSnapshot,
  UsageWindow,
} from "../domain/dashboard.js";
import {
  DEFAULT_USAGE_RANGE_PRESET_ID,
  type UsageRangePresetId,
} from "../domain/usage-range.js";
import { ProviderCollector } from "./provider-collector.js";
import { createUsageDateWindow } from "../providers/shared/date-window.js";

function createUsageWindow(now: Date, range: UsageRangePresetId, providers: ProviderSnapshot[] = []): UsageWindow {
  if (range !== "all") {
    return createUsageDateWindow(now, range).usageWindow;
  }

  const earliestLoadedDate = providers
    .filter(isLoadedProvider)
    .map((provider) => provider.usageWindow.since)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0];

  return createUsageDateWindow(now, range, { earliestAvailableAt: earliestLoadedDate }).usageWindow;
}

function createEmptySummary(
  now: Date,
  providerCount: number,
  selectedUsageRange: UsageRangePresetId,
): DashboardSummary {
  return {
    estimatedCost: 0,
    totalTokens: 0,
    providerCount,
    loadedProviderCount: 0,
    usageWindow: createUsageWindow(now, selectedUsageRange),
  };
}

function createInitialSnapshot(
  providerCount: number,
  selectedUsageRange: UsageRangePresetId,
): DashboardSnapshot {
  const now = new Date();

  return {
    summary: createEmptySummary(now, providerCount, selectedUsageRange),
    providers: [],
    notices: [],
    lastRefreshedAt: null,
    provenance: [],
    loadingState: "loading",
    selectedUsageRange,
  };
}

function isLoadedProvider(provider: ProviderSnapshot): boolean {
  return provider.status !== "error" && provider.status !== "empty";
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildNotices(providers: ProviderSnapshot[]): DashboardNotice[] {
  const errors = providers.filter((provider) => provider.status === "error");
  const stale = providers.filter((provider) => provider.status === "stale");
  const notices: DashboardNotice[] = [];

  if (errors.length > 0) {
    notices.push({
      level: "error",
      message: `${errors.length} of ${providers.length} providers failed to refresh.`,
    });
  }

  if (stale.length > 0) {
    notices.push({
      level: "warning",
      message: `${stale.length} provider${stale.length === 1 ? " is" : "s are"} showing stale data.`,
    });
  }

  return notices;
}

function buildSnapshot(
  providers: ProviderSnapshot[],
  loadingState: DashboardSnapshot["loadingState"],
  refreshedAt: string | null,
  selectedUsageRange: UsageRangePresetId,
): DashboardSnapshot {
  const loadedProviders = providers.filter(isLoadedProvider);
  const now = refreshedAt ? new Date(refreshedAt) : new Date();
  const usageWindow = createUsageWindow(now, selectedUsageRange, providers);

  return {
    summary: {
      estimatedCost: loadedProviders.reduce((total, provider) => total + provider.estimatedCost, 0),
      totalTokens: loadedProviders.reduce((total, provider) => total + provider.totalTokens, 0),
      providerCount: providers.length,
      loadedProviderCount: loadedProviders.length,
      usageWindow,
    },
    providers,
    notices: buildNotices(providers),
    lastRefreshedAt: refreshedAt,
    provenance: uniqueValues(providers.flatMap((provider) => provider.provenance)),
    loadingState,
    selectedUsageRange,
  };
}

function buildProviderErrorSnapshot(
  provider: { id: ProviderSnapshot["id"]; displayName: string },
  previousSnapshot: ProviderSnapshot | undefined,
  usageWindow: UsageWindow,
  cause: unknown,
): ProviderSnapshot {
  const detailMessage =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message
      : `${provider.displayName} data could not be loaded.`;

  if (previousSnapshot) {
    return {
      ...previousSnapshot,
      status: "stale",
      staleSince: previousSnapshot.staleSince ?? new Date().toISOString(),
      detailMessage,
      warnings: Array.from(new Set([...previousSnapshot.warnings, "Showing last known provider data."])),
      quotaStatus:
        previousSnapshot.quotaStatus === "available"
          ? "stale"
          : previousSnapshot.quotaStatus,
      costStatus:
        previousSnapshot.costStatus === "available"
          ? "stale"
          : previousSnapshot.costStatus,
    };
  }

  return {
    id: provider.id,
    displayName: provider.displayName,
    status: "error",
    usageWindow,
    inputTokens: 0,
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "source",
    activityCount: 0,
    activityLabel: provider.id === "codex" ? "Sessions" : "Active days",
    warnings: [],
    lastRefreshedAt: null,
    staleSince: null,
    provenance: [],
    detailMessage,
    quotaStatus: "unsupported",
    quotaStatusMessage: null,
    quotaLastRefreshedAt: null,
    costStatus: "unsupported",
    costStatusMessage: null,
    costLastRefreshedAt: null,
    quotaMeters: [],
  };
}

export class ProviderOrchestrator extends EventEmitter {
  private readonly providers: Array<{ id: ProviderSnapshot["id"]; displayName: string }>;
  private readonly collector: ProviderCollector;
  private pendingRefresh: Promise<DashboardSnapshot> | null = null;
  private snapshot: DashboardSnapshot;
  private readonly snapshotCache = new Map<UsageRangePresetId, DashboardSnapshot>();
  private selectedUsageRange: UsageRangePresetId = DEFAULT_USAGE_RANGE_PRESET_ID;

  constructor(
    providers: Array<{ id: ProviderSnapshot["id"]; displayName: string }>,
    collector: ProviderCollector,
  ) {
    super();
    this.providers = providers;
    this.collector = collector;
    this.snapshot = createInitialSnapshot(providers.length, this.selectedUsageRange);
  }

  getSnapshot(): DashboardSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<DashboardSnapshot> {
    this.snapshotCache.clear();
    return this.collectAndPublish(this.selectedUsageRange, true);
  }

  async setUsageRange(range: UsageRangePresetId): Promise<DashboardSnapshot> {
    if (range === this.selectedUsageRange && this.snapshot.lastRefreshedAt !== null) {
      return this.snapshot;
    }

    const cachedSnapshot = this.snapshotCache.get(range);
    if (cachedSnapshot) {
      this.selectedUsageRange = range;
      this.snapshot = {
        ...cachedSnapshot,
        loadingState: "idle",
        selectedUsageRange: range,
      };
      this.emit("changed", this.snapshot);
      return this.snapshot;
    }

    return this.collectAndPublish(range, false);
  }

  private async collectAndPublish(
    selectedUsageRange: UsageRangePresetId,
    forceRefresh: boolean,
  ): Promise<DashboardSnapshot> {
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    const current = this.snapshot;
    const loadingState =
      current.lastRefreshedAt === null
        ? "loading"
        : forceRefresh
          ? "refreshing"
          : "switching";

    this.snapshot = {
      ...current,
      loadingState,
      selectedUsageRange,
    };
    this.emit("changed", this.snapshot);

    this.pendingRefresh = (async () => {
      const now = new Date();
      const usageWindow = createUsageWindow(now, selectedUsageRange, current.providers);
      const previousById = new Map(current.providers.map((provider) => [provider.id, provider]));

      const results = await this.collector.collect(
        now,
        current.providers,
        selectedUsageRange,
        forceRefresh,
      );

      const providers = this.providers.map((provider, index) => {
        const result = results[index];
        if (!result || result.id !== provider.id) {
          return buildProviderErrorSnapshot(
            provider,
            previousById.get(provider.id),
            usageWindow,
            new Error("Collector returned provider data out of order."),
          );
        }

        if (result.ok) {
          return result.snapshot;
        }

        return buildProviderErrorSnapshot(
          provider,
          previousById.get(provider.id),
          usageWindow,
          new Error(result.errorMessage),
        );
      });

      this.selectedUsageRange = selectedUsageRange;
      this.snapshot = buildSnapshot(
        providers,
        "idle",
        now.toISOString(),
        this.selectedUsageRange,
      );
      this.snapshotCache.set(this.selectedUsageRange, this.snapshot);
      this.emit("changed", this.snapshot);

      return this.snapshot;
    })();

    try {
      return await this.pendingRefresh;
    } finally {
      this.pendingRefresh = null;
    }
  }
}
