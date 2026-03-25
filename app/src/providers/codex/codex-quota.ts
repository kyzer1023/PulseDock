import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderSnapshot, QuotaMeter, SectionAvailability } from "../../domain/dashboard.js";
import { markMetersStale } from "../shared/quota-meters.js";

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CodexWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}

interface CodexRateLimitDetails {
  primary_window?: CodexWindow;
  secondary_window?: CodexWindow;
}

interface CodexAdditionalRateLimit {
  limit_name?: string;
  metered_feature?: string;
  rate_limit?: CodexRateLimitDetails;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: CodexRateLimitDetails;
  code_review_rate_limit?: {
    primary_window?: CodexWindow;
  };
  additional_rate_limits?: CodexAdditionalRateLimit[];
}

export interface CodexQuotaSnapshot {
  quotaStatus: SectionAvailability;
  quotaStatusMessage: string | null;
  quotaLastRefreshedAt: string | null;
  quotaMeters: QuotaMeter[];
  warnings: string[];
  hasData: boolean;
}

export type { CodexUsageResponse };

function resolveCodexAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEX_HOME) {
    return path.join(path.resolve(env.CODEX_HOME), "auth.json");
  }

  return path.join(os.homedir(), ".codex", "auth.json");
}

async function loadCodexAccessToken(): Promise<{ accessToken: string; accountId: string | null } | null> {
  const authPath = resolveCodexAuthPath(process.env);

  let raw: string;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch {
    return null;
  }

  let parsed: CodexAuthFile;
  try {
    parsed = JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }

  const accessToken = parsed.tokens?.access_token?.trim();
  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    accountId: parsed.tokens?.account_id?.trim() || null,
  };
}

function makePercentMeter(id: string, label: string, window: CodexWindow | undefined): QuotaMeter | null {
  if (!window || typeof window.used_percent !== "number") {
    return null;
  }

  return {
    id,
    label,
    kind: "percent",
    used: window.used_percent,
    limit: 100,
    displayMode: "remaining",
    resetAt:
      typeof window.reset_at === "number"
        ? new Date(window.reset_at * 1000).toISOString()
        : null,
    periodSeconds:
      typeof window.limit_window_seconds === "number" ? window.limit_window_seconds : null,
    availability: "available",
    sourceLabel: "Codex live quota",
  };
}

function makeAdditionalLabel(value: string | undefined, fallback: string): string {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  return value
    .replace(/^GPT-[\d.]+-Codex-/i, "")
    .replace(/_/g, " ")
    .trim();
}

export function mapCodexQuotaPayload(
  payload: CodexUsageResponse,
  now: Date,
  previousSnapshot: ProviderSnapshot | undefined,
): CodexQuotaSnapshot {
  const meters: QuotaMeter[] = [];
  const primary = makePercentMeter("session", "Session (5h)", payload.rate_limit?.primary_window);
  const secondary = makePercentMeter("weekly", "Weekly", payload.rate_limit?.secondary_window);
  if (primary) {
    meters.push(primary);
  }
  if (secondary) {
    meters.push(secondary);
  }

  const reviewMeter = makePercentMeter("reviews", "Reviews", payload.code_review_rate_limit?.primary_window);
  if (reviewMeter) {
    meters.push(reviewMeter);
  }

  for (const additional of payload.additional_rate_limits ?? []) {
    const label = makeAdditionalLabel(additional.limit_name ?? additional.metered_feature, "Additional limit");
    const additionalPrimary = makePercentMeter(
      `${label.toLowerCase().replace(/\s+/g, "-")}-session`,
      label,
      additional.rate_limit?.primary_window,
    );
    const additionalSecondary = makePercentMeter(
      `${label.toLowerCase().replace(/\s+/g, "-")}-weekly`,
      `${label} Weekly`,
      additional.rate_limit?.secondary_window,
    );
    if (additionalPrimary) {
      meters.push(additionalPrimary);
    }
    if (additionalSecondary) {
      meters.push(additionalSecondary);
    }
  }

  if (meters.length === 0) {
    return {
      quotaStatus: previousSnapshot?.quotaMeters.length ? "stale" : "unsupported",
      quotaStatusMessage: "Codex live quota did not expose any supported meter windows.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: previousSnapshot?.quotaMeters.length ? markMetersStale(previousSnapshot.quotaMeters) : [],
      warnings: [],
      hasData: Boolean(previousSnapshot?.quotaMeters.length),
    };
  }

  return {
    quotaStatus: "available",
    quotaStatusMessage: payload.plan_type ? `Codex ${payload.plan_type} live quota` : null,
    quotaLastRefreshedAt: now.toISOString(),
    quotaMeters: meters,
    warnings: [],
    hasData: true,
  };
}

export async function fetchCodexQuota(
  now: Date,
  previousSnapshot: ProviderSnapshot | undefined,
): Promise<CodexQuotaSnapshot> {
  const credentials = await loadCodexAccessToken();
  if (!credentials) {
    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: "Codex live quota requires a local Codex OAuth session.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: [],
      hasData: false,
    };
  }

  const headers = new Headers({
    Authorization: `Bearer ${credentials.accessToken}`,
    Accept: "application/json",
    "User-Agent": "PulseDock",
  });

  if (credentials.accountId) {
    headers.set("ChatGPT-Account-Id", credentials.accountId);
  }

  let response: Response;
  try {
    response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  } catch {
    if (previousSnapshot && previousSnapshot.quotaMeters.length > 0) {
      return {
        quotaStatus: "stale",
        quotaStatusMessage: "Codex live quota could not be refreshed. Showing last known values.",
        quotaLastRefreshedAt: previousSnapshot.quotaLastRefreshedAt,
        quotaMeters: markMetersStale(previousSnapshot.quotaMeters),
        warnings: ["Codex live quota refresh failed."],
        hasData: true,
      };
    }

    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: "Codex live quota is currently unavailable.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: ["Codex live quota refresh failed."],
      hasData: false,
    };
  }

  if (!response.ok) {
    if (previousSnapshot && previousSnapshot.quotaMeters.length > 0) {
      return {
        quotaStatus: "stale",
        quotaStatusMessage: "Codex live quota could not be refreshed. Showing last known values.",
        quotaLastRefreshedAt: previousSnapshot.quotaLastRefreshedAt,
        quotaMeters: markMetersStale(previousSnapshot.quotaMeters),
        warnings: [`Codex live quota request failed with HTTP ${response.status}.`],
        hasData: true,
      };
    }

    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: `Codex live quota request failed with HTTP ${response.status}.`,
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: [],
      hasData: false,
    };
  }

  let payload: CodexUsageResponse;
  try {
    payload = (await response.json()) as CodexUsageResponse;
  } catch {
    return {
      quotaStatus: previousSnapshot?.quotaMeters.length ? "stale" : "unsupported",
      quotaStatusMessage: "Codex live quota returned an invalid response.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: previousSnapshot?.quotaMeters.length ? markMetersStale(previousSnapshot.quotaMeters) : [],
      warnings: ["Codex live quota response could not be parsed."],
      hasData: Boolean(previousSnapshot?.quotaMeters.length),
    };
  }

  return mapCodexQuotaPayload(payload, now, previousSnapshot);
}
