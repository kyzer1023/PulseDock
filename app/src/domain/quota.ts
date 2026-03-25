import type { QuotaMeter } from "./dashboard.js";

function formatCompactNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCurrency(value: number, currencyCode = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCountdown(targetIso: string): string {
  const diffMs = new Date(targetIso).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return "Resets soon";
  }

  const totalMinutes = Math.round(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Resets in ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }

  return `Resets in ${Math.max(minutes, 1)}m`;
}

function getDisplayedQuotaValue(meter: QuotaMeter): number {
  if (meter.displayMode !== "remaining" || meter.limit === null) {
    return meter.used;
  }

  return Math.max(meter.limit - meter.used, 0);
}

export function formatQuotaMeterValue(meter: QuotaMeter): string {
  const displayValue = getDisplayedQuotaValue(meter);

  switch (meter.kind) {
    case "percent":
      return `${Math.round(displayValue)}%`;
    case "count":
      return meter.limit === null
        ? `${formatCompactNumber(displayValue)}${meter.unitLabel ? ` ${meter.unitLabel}` : ""}`
        : `${formatCompactNumber(displayValue)} / ${formatCompactNumber(meter.limit)}`;
    case "currency":
      return meter.limit === null
        ? formatCurrency(displayValue, meter.currencyCode)
        : `${formatCurrency(displayValue, meter.currencyCode)} / ${formatCurrency(
            meter.limit,
            meter.currencyCode,
          )}`;
  }
}

export function getQuotaMeterPercent(meter: QuotaMeter): number {
  if (meter.kind === "percent") {
    return Math.min(Math.max(getDisplayedQuotaValue(meter), 0), 100);
  }

  if (meter.limit === null || meter.limit <= 0) {
    return 0;
  }

  return Math.min(Math.max((getDisplayedQuotaValue(meter) / meter.limit) * 100, 0), 100);
}

export function formatQuotaMeterMeta(meter: QuotaMeter): string {
  if (meter.availability === "manual-required") {
    return "Manual auth required";
  }

  if (meter.availability === "stale") {
    return "Showing last known quota";
  }

  if (meter.resetAt) {
    return formatCountdown(meter.resetAt);
  }

  if (meter.periodSeconds) {
    const hours = Math.round(meter.periodSeconds / 3600);
    return `Window ${hours}h`;
  }

  return "No reset data";
}
