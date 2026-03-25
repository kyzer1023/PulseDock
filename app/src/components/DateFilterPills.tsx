import { useState } from "react";

export interface FilterPreset {
  id: string;
  label: string;
  shortLabel: string;
  days: number | null;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "today", label: "Today", shortLabel: "1D", days: 1 },
  { id: "3d", label: "Last 3 days", shortLabel: "3D", days: 3 },
  { id: "7d", label: "Last 7 days", shortLabel: "7D", days: 7 },
  { id: "14d", label: "Last 14 days", shortLabel: "14D", days: 14 },
  { id: "30d", label: "Last 30 days", shortLabel: "30D", days: 30 },
  { id: "all", label: "All time", shortLabel: "All", days: null },
];

interface DateFilterPillsProps {
  value: string;
  onChange: (presetId: string) => void;
  accent: "codex" | "cursor";
}

export function DateFilterPills({ value, onChange, accent }: DateFilterPillsProps) {
  return (
    <div className="filter-pills" role="radiogroup" aria-label="Usage time range">
      <div className="filter-pills__track">
        {FILTER_PRESETS.map((preset) => {
          const isActive = preset.id === value;
          return (
            <button
              key={preset.id}
              className={`filter-pill filter-pill--${accent}${isActive ? " is-active" : ""}`}
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(preset.id)}
              title={preset.label}
              type="button"
            >
              <span className="filter-pill__label">{preset.shortLabel}</span>
            </button>
          );
        })}
      </div>
      <span className="filter-pills__hint">
        {FILTER_PRESETS.find((p) => p.id === value)?.label ?? "Last 7 days"}
      </span>
    </div>
  );
}
