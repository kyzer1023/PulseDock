import { EventEmitter } from "node:events";
import type {
  DashboardNotice,
  DashboardSnapshot,
  DashboardSummary,
  ProviderSnapshot,
  UsageProvider,
  UsageWindow,
} from "../domain/dashboard.js";

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

  if (warnings.length > 0 && errors.length === 0 && stale.length === 0) {
    notices.push({
      level: "warning",
      message: "Some provider data is approximate and should be treated as advisory.",
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
  provider: UsageProvider,
  previousSnapshot: ProviderSnapshot | undefined,
  usageWindow: UsageWindow,
  cause: unknown,
): ProviderSnapshot {
  const detailMessage =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message
      : `${provider.displayName} data could not be loaded.`;

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
    lastRefreshedAt: previousSnapshot?.lastRefreshedAt ?? null,
    staleSince: null,
    provenance: previousSnapshot?.provenance ?? [],
    detailMessage,
    planMeters: [],
  };
}

export class ProviderOrchestrator extends EventEmitter {
  private readonly providers: UsageProvider[];
  private pendingRefresh: Promise<DashboardSnapshot> | null = null;
  private snapshot: DashboardSnapshot;

  constructor(providers: UsageProvider[]) {
    super();
    this.providers = providers;
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

      const results = await Promise.allSettled(
        this.providers.map((provider) =>
          provider.getSnapshot({
            now,
            previousSnapshot: previousById.get(provider.id),
          }),
        ),
      );

      const providers = results.map((result, index) => {
        const provider = this.providers[index];
        if (!provider) {
          throw new Error(`Missing provider definition at index ${index}.`);
        }

        if (result.status === "fulfilled") {
          return result.value;
        }

        return buildProviderErrorSnapshot(
          provider,
          previousById.get(provider.id),
          usageWindow,
          result.reason,
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
