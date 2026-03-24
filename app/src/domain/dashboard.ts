export type ProviderId = "codex" | "cursor";

export type ProviderStatus =
  | "fresh"
  | "warning"
  | "stale"
  | "error"
  | "empty";

export type LoadingState = "idle" | "loading" | "refreshing";

export interface UsageWindow {
  label: string;
  since: string;
  until: string;
}

export interface ProviderSnapshot {
  id: ProviderId;
  displayName: string;
  status: ProviderStatus;
  usageWindow: UsageWindow;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
  topLabel: string | null;
  topLabelType: "model" | "provider" | "source";
  activityCount: number;
  activityLabel: string;
  warnings: string[];
  lastRefreshedAt: string | null;
  staleSince: string | null;
  provenance: string[];
  detailMessage: string | null;
}

export interface DashboardSummary {
  estimatedCost: number;
  totalTokens: number;
  providerCount: number;
  loadedProviderCount: number;
  usageWindow: UsageWindow;
}

export interface DashboardNotice {
  level: "warning" | "error";
  message: string;
}

export interface DashboardSnapshot {
  summary: DashboardSummary;
  providers: ProviderSnapshot[];
  notices: DashboardNotice[];
  lastRefreshedAt: string | null;
  provenance: string[];
  loadingState: LoadingState;
}

export interface ProviderContext {
  now: Date;
  previousSnapshot: ProviderSnapshot | undefined;
}

export interface UsageProvider {
  id: ProviderId;
  displayName: string;
  getSnapshot(context: ProviderContext): Promise<ProviderSnapshot>;
}

export interface PulseDockApi {
  getDashboard(): Promise<DashboardSnapshot>;
  refreshDashboard(): Promise<DashboardSnapshot>;
  openExternal(url: string): Promise<void>;
  quitApp(): Promise<void>;
  onDashboardChanged(listener: (snapshot: DashboardSnapshot) => void): () => void;
}
