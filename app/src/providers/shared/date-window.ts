import type { UsageWindow } from "../../domain/dashboard.js";
import {
  getUsageRangePreset,
  type UsageRangePresetId,
} from "../../domain/usage-range.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDashDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatCompactDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface UsageDateWindow {
  usageWindow: UsageWindow;
  codexSince: string;
  codexUntil: string;
  cursorSince: string;
  cursorUntil: string;
  sinceDate: Date;
  untilDate: Date;
}

export function createUsageDateWindow(
  now: Date,
  range: UsageRangePresetId,
  options: { earliestAvailableAt?: Date | null | undefined } = {},
): UsageDateWindow {
  const preset = getUsageRangePreset(range);
  const untilDate = startOfLocalDay(now);
  const sinceDate = startOfLocalDay(options.earliestAvailableAt ?? now);

  if (preset.trailingDays !== null) {
    sinceDate.setDate(untilDate.getDate() - (preset.trailingDays - 1));
  }

  return {
    usageWindow: {
      label: preset.windowLabel,
      since: sinceDate.toISOString(),
      until: now.toISOString(),
    },
    codexSince: formatDashDate(sinceDate),
    codexUntil: formatDashDate(untilDate),
    cursorSince: formatCompactDate(sinceDate),
    cursorUntil: formatCompactDate(untilDate),
    sinceDate,
    untilDate,
  };
}
