import { Worker } from "node:worker_threads";
import type { ProviderSnapshot } from "../domain/dashboard.js";
import type { UsageRangePresetId } from "../domain/usage-range.js";
import type {
  CollectRequest,
  CollectResponse,
  ProviderCollectResult,
} from "./provider-collector-contract.js";

export class ProviderCollector {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (results: ProviderCollectResult[]) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl);
    this.worker.on("message", (message: CollectResponse) => {
      const request = this.pending.get(message.id);
      if (!request) {
        return;
      }

      this.pending.delete(message.id);
      request.resolve(message.results);
    });
    this.worker.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.worker.on("exit", (code) => {
      if (code !== 0) {
        this.rejectAll(new Error(`Provider collector exited with code ${code}.`));
      }
    });
  }

  collect(
    now: Date,
    previousSnapshots: ProviderSnapshot[],
    selectedUsageRange: UsageRangePresetId,
    forceRefresh: boolean,
  ): Promise<ProviderCollectResult[]> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      const payload: CollectRequest = {
        id,
        nowIso: now.toISOString(),
        previousSnapshots,
        selectedUsageRange,
        forceRefresh,
      };

      this.worker.postMessage(payload);
    });
  }

  dispose(): void {
    this.rejectAll(new Error("Provider collector disposed."));
    void this.worker.terminate();
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }

    this.pending.clear();
  }
}

export type { ProviderCollectResult };
