import type { ProviderSnapshot } from "../domain/dashboard.js";

export interface CollectRequest {
  id: number;
  nowIso: string;
  previousSnapshots: ProviderSnapshot[];
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
