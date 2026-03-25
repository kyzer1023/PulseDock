import { EventEmitter } from "node:events";
import type {
  DashboardNotice,
  DashboardSnapshot,
  DashboardSummary,
  ProviderSnapshot,
  UsageWindow,
} from "../domain/dashboard.js";
import { ProviderCollector } from "./provider-collector.js";

function createUsageWindow(now: Date): UsageWindow {
  const since = new Date(now);
  since.setDate(now.getDate() - 6);

  return {
    label: "Last 7 days",
    since: since.toISOString(),
    until: now.toISOString(),
  };
}

function createEmptySummary(now: Date, providerCount: number): DashboardSummary {
  return {
    estimatedCost: 0,
    totalTokens: 0,
    providerCount,
    loadedProviderCount: 0,
    usageWindow: createUsageWindow(now),
  };
}

function createInitialSnapshot(
  providerCount: number,
): DashboardSnapshot {
  const now = new Date();

  return {
    summary: createEmptySummary(now, providerCount),
    providers: [],
    notices: [],
    lastRefreshedAt: null,
    provenance: [],
    loadingState: "loading",
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
  const warnings = providers.filter((provider) => provider.status === "warning");
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
): DashboardSnapshot {
  const loadedProviders = providers.filter(isLoadedProvider);
  const usageWindow = loadedProviders[0]?.usageWindow ?? createUsageWindow(new Date());

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

  constructor(
    providers: Array<{ id: ProviderSnapshot["id"]; displayName: string }>,
    collector: ProviderCollector,
  ) {
    super();
    this.providers = providers;
    this.collector = collector;
    this.snapshot = createInitialSnapshot(providers.length);
  }

  getSnapshot(): DashboardSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<DashboardSnapshot> {
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    const current = this.snapshot;
    const loadingState = current.lastRefreshedAt === null ? "loading" : "refreshing";

    this.snapshot = {
      ...current,
      loadingState,
    };
    this.emit("changed", this.snapshot);

    this.pendingRefresh = (async () => {
      const now = new Date();
      const usageWindow = createUsageWindow(now);
      const previousById = new Map(current.providers.map((provider) => [provider.id, provider]));

      const results = await this.collector.collect(now, current.providers);

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

      this.snapshot = buildSnapshot(providers, "idle", now.toISOString());
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
