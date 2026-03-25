import type { ProviderSnapshot, QuotaMeter, SectionAvailability } from "../../domain/dashboard.js";
import { getCursorAuthStateReadOnly } from "./cursor-auth.js";

interface CursorUsageSummaryResponse {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  autoModelSelectedDisplayMessage?: string;
  namedModelSelectedDisplayMessage?: string;
  individualUsage?: {
    plan?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
      autoPercentUsed?: number;
      apiPercentUsed?: number;
      totalPercentUsed?: number;
    };
    onDemand?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
    };
  };
  teamUsage?: {
    plan?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
      autoPercentUsed?: number;
      apiPercentUsed?: number;
      totalPercentUsed?: number;
    };
    onDemand?: {
      enabled?: boolean;
      used?: number;
      limit?: number | null;
      remaining?: number | null;
    };
  };
}

interface LegacyUsageResponse {
  "gpt-4"?: {
    numRequests?: number;
    numRequestsTotal?: number;
    maxRequestUsage?: number;
  };
}

export interface CursorQuotaSnapshot {
  quotaStatus: SectionAvailability;
  quotaStatusMessage: string | null;
  quotaLastRefreshedAt: string | null;
  quotaMeters: QuotaMeter[];
  warnings: string[];
  hasData: boolean;
}

export type { CursorUsageSummaryResponse };

const USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const LEGACY_USAGE_URL = "https://cursor.com/api/usage";

function stalePreviousMeters(previous: QuotaMeter[]): QuotaMeter[] {
  return previous.map((meter) => ({
    ...meter,
    availability: meter.availability === "available" ? "stale" : meter.availability,
  }));
}

function parseDateStringToIso(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function makePercentMeter(id: string, label: string, used: number, resetAt: string | null, periodSeconds: number | null): QuotaMeter {
  return {
    id,
    label,
    kind: "percent",
    used,
    limit: 100,
    resetAt,
    periodSeconds,
    availability: "available",
    sourceLabel: "Cursor live quota",
  };
}

function makeCurrencyMeter(id: string, label: string, usedCents: number, limitCents: number, resetAt: string | null, periodSeconds: number | null): QuotaMeter {
  return {
    id,
    label,
    kind: "currency",
    used: usedCents / 100,
    limit: limitCents / 100,
    currencyCode: "USD",
    resetAt,
    periodSeconds,
    availability: "available",
    sourceLabel: "Cursor live quota",
  };
}

function makeCountMeter(
  id: string,
  label: string,
  used: number,
  limit: number,
  resetAt: string | null,
  periodSeconds: number | null,
): QuotaMeter {
  return {
    id,
    label,
    kind: "count",
    used,
    limit,
    unitLabel: "requests",
    resetAt,
    periodSeconds,
    availability: "available",
    sourceLabel: "Cursor legacy quota",
  };
}

function getBillingPeriodSeconds(start: string | undefined, end: string | undefined): number | null {
  const startMs = start ? Date.parse(start) : Number.NaN;
  const endMs = end ? Date.parse(end) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function buildCursorSessionCookie(accessToken: string, subject: string): string {
  const userId = subject.split("|").pop()?.trim();
  if (!userId) {
    throw new Error("Cursor local session is missing a usable subject identifier.");
  }

  return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${accessToken}`)}`;
}

async function getJson<T>(url: string, cookieHeader: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard",
    },
  });

  if (!response.ok) {
    throw new Error(`Cursor quota request failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function mapCursorCurrentPlanQuota(
  usage: CursorUsageSummaryResponse,
  now: Date,
): CursorQuotaSnapshot {
  const resetAt = parseDateStringToIso(usage.billingCycleEnd);
  const billingPeriodSeconds = getBillingPeriodSeconds(usage.billingCycleStart, usage.billingCycleEnd);
  const meters: QuotaMeter[] = [];
  const usageScope = usage.limitType === "team" && usage.teamUsage?.plan ? usage.teamUsage : usage.individualUsage;
  const plan = usageScope?.plan;
  const onDemand = usageScope?.onDemand;
  const planLabel = usage.membershipType ? `Cursor ${usage.membershipType.replace(/_/g, " ")}` : "Cursor quota";

  if (plan?.enabled) {
    const isTeamPlan = usage.limitType === "team";
    const limit = plan.limit;
    const remaining = plan.remaining ?? 0;
    const totalSpend = plan.used ?? (typeof limit === "number" ? limit - remaining : 0);
    const totalPercentUsed =
      typeof plan.totalPercentUsed === "number"
        ? plan.totalPercentUsed
        : typeof limit === "number" && limit > 0
          ? (totalSpend / limit) * 100
          : 0;

    if (isTeamPlan && typeof limit === "number" && limit > 0) {
      meters.push(makeCurrencyMeter("total-usage", "Total usage", totalSpend, limit, resetAt, billingPeriodSeconds));
    } else {
      meters.push(makePercentMeter("total-usage", "Total usage", totalPercentUsed, resetAt, billingPeriodSeconds));
    }

    if (typeof plan.autoPercentUsed === "number") {
      meters.push(makePercentMeter("auto-usage", "Auto usage", plan.autoPercentUsed, resetAt, billingPeriodSeconds));
    }

    if (typeof plan.apiPercentUsed === "number") {
      meters.push(makePercentMeter("api-usage", "API usage", plan.apiPercentUsed, resetAt, billingPeriodSeconds));
    }

    const onDemandLimit = onDemand?.limit ?? null;
    const onDemandRemaining = onDemand?.remaining ?? null;
    if (typeof onDemandLimit === "number" && onDemandLimit > 0 && typeof onDemandRemaining === "number") {
      meters.push(
        makeCurrencyMeter(
          "on-demand",
          "On-demand",
          onDemandLimit - onDemandRemaining,
          onDemandLimit,
          resetAt,
          billingPeriodSeconds,
        ),
      );
    }
  }

  return {
    quotaStatus: "available",
    quotaStatusMessage: planLabel,
    quotaLastRefreshedAt: now.toISOString(),
    quotaMeters: meters,
    warnings: [],
    hasData: meters.length > 0,
  };
}

async function fetchLegacyRequestQuota(
  cookieHeader: string,
  userId: string,
  resetAt: string | null,
  periodSeconds: number | null,
): Promise<QuotaMeter | null> {
  const url = new URL(LEGACY_USAGE_URL);
  url.searchParams.set("user", userId);

  const response = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Cursor legacy request quota failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as LegacyUsageResponse;
  const requestsUsed = payload["gpt-4"]?.numRequestsTotal ?? payload["gpt-4"]?.numRequests ?? 0;
  const requestsLimit = payload["gpt-4"]?.maxRequestUsage;

  if (typeof requestsLimit !== "number" || requestsLimit <= 0) {
    return null;
  }

  return makeCountMeter("requests", "Requests", requestsUsed, requestsLimit, resetAt, periodSeconds);
}

export async function fetchCursorQuota(
  now: Date,
  previousSnapshot: ProviderSnapshot | undefined,
): Promise<CursorQuotaSnapshot> {
  const authState = getCursorAuthStateReadOnly();
  const accessToken = authState.accessToken;
  const subject = authState.subject;

  if (!accessToken || !subject) {
    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: "Cursor live quota requires an active, unexpired local Cursor session.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: [],
      hasData: false,
    };
  }

  let cookieHeader: string;
  try {
    cookieHeader = buildCursorSessionCookie(accessToken, subject);
  } catch (error) {
    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: error instanceof Error ? error.message : "Cursor session cookies could not be built.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: [],
      hasData: false,
    };
  }

  const userId = subject.split("|").pop()?.trim() || null;
  let usageSummary: CursorUsageSummaryResponse;
  let legacyMeter: QuotaMeter | null = null;
  try {
    usageSummary = await getJson<CursorUsageSummaryResponse>(USAGE_SUMMARY_URL, cookieHeader);
    if (userId) {
      legacyMeter = await fetchLegacyRequestQuota(
        cookieHeader,
        userId,
        parseDateStringToIso(usageSummary.billingCycleEnd),
        getBillingPeriodSeconds(usageSummary.billingCycleStart, usageSummary.billingCycleEnd),
      ).catch(() => null);
    }
  } catch (error) {
    if (previousSnapshot?.quotaMeters.length) {
      return {
        quotaStatus: "stale",
        quotaStatusMessage: "Cursor live quota could not be refreshed. Showing last known values.",
        quotaLastRefreshedAt: previousSnapshot.quotaLastRefreshedAt,
        quotaMeters: stalePreviousMeters(previousSnapshot.quotaMeters),
        warnings: [error instanceof Error ? error.message : "Cursor live quota refresh failed."],
        hasData: true,
      };
    }

    return {
      quotaStatus: "unsupported",
      quotaStatusMessage: error instanceof Error ? error.message : "Cursor live quota is unavailable.",
      quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? null,
      quotaMeters: [],
      warnings: [],
      hasData: false,
    };
  }

  if (legacyMeter) {
    return {
      quotaStatus: "available",
      quotaStatusMessage: "Cursor legacy request quota",
      quotaLastRefreshedAt: now.toISOString(),
      quotaMeters: [legacyMeter],
      warnings: [],
      hasData: true,
    };
  }

  const modernSnapshot = mapCursorCurrentPlanQuota(usageSummary, now);
  if (modernSnapshot.hasData) {
    return modernSnapshot;
  }

  return {
    quotaStatus: "unsupported",
    quotaStatusMessage: "Cursor is authenticated, but this account did not expose any supported quota metrics.",
    quotaLastRefreshedAt: previousSnapshot?.quotaLastRefreshedAt ?? now.toISOString(),
    quotaMeters: [],
    warnings: [],
    hasData: false,
  };
}
