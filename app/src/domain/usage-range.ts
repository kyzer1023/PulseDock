export type UsageRangePresetId = "today" | "week" | "month" | "all";

export interface UsageRangePreset {
  id: UsageRangePresetId;
  label: string;
  metaLabel: string;
  trailingDays: number | null;
  windowLabel: string;
}

export const DEFAULT_USAGE_RANGE_PRESET_ID: UsageRangePresetId = "week";

export const USAGE_RANGE_PRESETS: UsageRangePreset[] = [
  {
    id: "today",
    label: "Today",
    metaLabel: "1D",
    trailingDays: 1,
    windowLabel: "Today",
  },
  {
    id: "week",
    label: "Week",
    metaLabel: "7D",
    trailingDays: 7,
    windowLabel: "Last 7 days",
  },
  {
    id: "month",
    label: "Month",
    metaLabel: "30D",
    trailingDays: 30,
    windowLabel: "Last 30 days",
  },
  {
    id: "all",
    label: "All time",
    metaLabel: "\u221e",
    trailingDays: null,
    windowLabel: "All time",
  },
];

const RANGE_ORDER: Record<UsageRangePresetId, number> = {
  today: 0,
  week: 1,
  month: 2,
  all: 3,
};

export function getUsageRangePreset(range: UsageRangePresetId): UsageRangePreset {
  return USAGE_RANGE_PRESETS.find((preset) => preset.id === range) ?? USAGE_RANGE_PRESETS[1]!;
}

export function getUsageRangeOrder(range: UsageRangePresetId): number {
  return RANGE_ORDER[range];
}

export function usageRangeCovers(
  cachedRange: UsageRangePresetId,
  requestedRange: UsageRangePresetId,
): boolean {
  return getUsageRangeOrder(cachedRange) >= getUsageRangeOrder(requestedRange);
}
