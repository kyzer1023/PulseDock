import type { UsageRangePresetId } from "./usage-range.js";

export type ProviderId = "codex" | "cursor";

export type ProviderStatus =
  | "fresh"
  | "warning"
  | "stale"
  | "error"
  | "empty";

export type LoadingState = "idle" | "loading" | "refreshing" | "switching";

export interface UsageWindow {
  label: string;
  since: string;
  until: string;
}

export type SectionAvailability =
  | "available"
  | "stale"
  | "unsupported"
  | "manual-required";

export interface QuotaMeter {
  id: string;
  label: string;
  kind: "percent" | "count" | "currency";
  used: number;
  limit: number | null;
  displayMode?: "used" | "remaining";
  currencyCode?: string;
  unitLabel?: string;
  resetAt: string | null;
  periodSeconds: number | null;
  availability: SectionAvailability;
  sourceLabel: string | null;
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
  quotaStatus: SectionAvailability;
  quotaStatusMessage: string | null;
  quotaLastRefreshedAt: string | null;
  costStatus: SectionAvailability;
  costStatusMessage: string | null;
  costLastRefreshedAt: string | null;
  quotaMeters: QuotaMeter[];
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
  selectedUsageRange: UsageRangePresetId;
}

export interface ProviderContext {
  now: Date;
  previousSnapshot: ProviderSnapshot | undefined;
  selectedUsageRange: UsageRangePresetId;
  forceRefresh: boolean;
}

export interface UsageProvider {
  id: ProviderId;
  displayName: string;
  getSnapshot(context: ProviderContext): Promise<ProviderSnapshot>;
}

export interface PulseDockApi {
  getDashboard(): Promise<DashboardSnapshot>;
  refreshDashboard(): Promise<DashboardSnapshot>;
  setDashboardUsageRange(range: UsageRangePresetId): Promise<DashboardSnapshot>;
  openExternal(url: string): Promise<void>;
  quitApp(): Promise<void>;
  onDashboardChanged(listener: (snapshot: DashboardSnapshot) => void): () => void;
}
