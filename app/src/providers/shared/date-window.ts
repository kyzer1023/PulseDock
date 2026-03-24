import type { UsageWindow } from "../../domain/dashboard.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDashDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatCompactDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export interface RecentDateWindow {
  usageWindow: UsageWindow;
  codexSince: string;
  codexUntil: string;
  cursorSince: string;
  cursorUntil: string;
}

export function createRecentDateWindow(now: Date, days = 7): RecentDateWindow {
  const untilDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceDate = new Date(untilDate);
  sinceDate.setDate(untilDate.getDate() - (days - 1));

  return {
    usageWindow: {
      label: `Last ${days} days`,
      since: sinceDate.toISOString(),
      until: now.toISOString(),
    },
    codexSince: formatDashDate(sinceDate),
    codexUntil: formatDashDate(untilDate),
    cursorSince: formatCompactDate(sinceDate),
    cursorUntil: formatCompactDate(untilDate),
  };
}
