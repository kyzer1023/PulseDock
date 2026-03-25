import { parentPort } from "node:worker_threads";
import type { ProviderContext, ProviderSnapshot } from "../domain/dashboard.js";
import { providers } from "../providers/index.js";

interface CollectRequest {
  id: number;
  nowIso: string;
  previousSnapshots: ProviderSnapshot[];
}

interface ProviderCollectSuccess {
  id: string;
  ok: true;
  snapshot: ProviderSnapshot;
}

interface ProviderCollectFailure {
  id: string;
  ok: false;
  errorMessage: string;
}

interface CollectResponse {
  id: number;
  results: Array<ProviderCollectSuccess | ProviderCollectFailure>;
}

async function handleCollect(
  request: CollectRequest,
): Promise<CollectResponse> {
  const previousById = new Map(request.previousSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const now = new Date(request.nowIso);

  const results = await Promise.all(
    providers.map(async (provider) => {
      const context: ProviderContext = {
        now,
        previousSnapshot: previousById.get(provider.id),
      };

      try {
        const snapshot = await provider.getSnapshot(context);
        return {
          id: provider.id,
          ok: true,
          snapshot,
        } satisfies ProviderCollectSuccess;
      } catch (error) {
        return {
          id: provider.id,
          ok: false,
          errorMessage:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : `${provider.displayName} data could not be loaded.`,
        } satisfies ProviderCollectFailure;
      }
    }),
  );

  return {
    id: request.id,
    results,
  };
}

const workerPort = parentPort;

if (workerPort) {
  workerPort.on("message", (request: CollectRequest) => {
    void handleCollect(request).then((response) => {
      workerPort.postMessage(response);
    });
  });
}
