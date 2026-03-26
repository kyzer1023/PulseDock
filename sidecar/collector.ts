import type { ProviderContext } from "../app/src/domain/dashboard.js";
import { providers } from "../app/src/providers/index.js";
import type {
  CollectRequest,
  CollectResponse,
  ProviderCollectFailure,
  ProviderCollectSuccess,
} from "../app/src/application/provider-collector-contract.js";

function decodeRequest(encoded: string): CollectRequest {
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(json) as CollectRequest;
}

async function handleCollect(request: CollectRequest): Promise<CollectResponse> {
  const previousById = new Map(request.previousSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const now = new Date(request.nowIso);

  const results = await Promise.all(
    providers.map(async (provider) => {
      const context: ProviderContext = {
        now,
        previousSnapshot: previousById.get(provider.id),
        selectedUsageRange: request.selectedUsageRange,
        forceRefresh: request.forceRefresh,
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

async function main(): Promise<void> {
  const encodedRequest = process.argv[2];
  if (!encodedRequest) {
    throw new Error("Missing base64url-encoded collector request.");
  }

  const request = decodeRequest(encodedRequest);
  const response = await handleCollect(request);
  process.stdout.write(JSON.stringify(response));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
