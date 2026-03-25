import type { ProviderSnapshot } from "../domain/dashboard.js";
import type { UsageRangePresetId } from "../domain/usage-range.js";

export interface CollectRequest {
  id: number;
  nowIso: string;
  previousSnapshots: ProviderSnapshot[];
  selectedUsageRange: UsageRangePresetId;
  forceRefresh: boolean;
}

export interface ProviderCollectSuccess {
  id: string;
  ok: true;
  snapshot: ProviderSnapshot;
}

export interface ProviderCollectFailure {
  id: string;
  ok: false;
  errorMessage: string;
}

export type ProviderCollectResult = ProviderCollectSuccess | ProviderCollectFailure;

export interface CollectResponse {
  id: number;
  results: ProviderCollectResult[];
}
