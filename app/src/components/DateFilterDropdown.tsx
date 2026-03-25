import { useEffect, useRef, useState } from "react";
import {
  getUsageRangePreset,
  USAGE_RANGE_PRESETS,
  type UsageRangePresetId,
} from "@domain/usage-range";

interface DateFilterDropdownProps {
  value: UsageRangePresetId;
  onChange: (presetId: UsageRangePresetId) => void;
  accent: "codex" | "cursor";
  disabled?: boolean;
  isLoading?: boolean;
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`filter-dropdown__chevron${open ? " is-open" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function FilterSpinner() {
  return <span aria-hidden="true" className="filter-dropdown__spinner" />;
}

export function DateFilterDropdown({
  value,
  onChange,
  accent,
  disabled = false,
  isLoading = false,
}: DateFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = getUsageRangePreset(value);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  function handleSelect(presetId: UsageRangePresetId) {
    onChange(presetId);
    setOpen(false);
  }

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        className={`filter-dropdown__trigger filter-dropdown__trigger--${accent}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={isLoading}
        disabled={disabled}
        type="button"
      >
        <CalendarIcon />
        <span className="filter-dropdown__trigger-label">{selected.label}</span>
        {isLoading ? <FilterSpinner /> : null}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className={`filter-dropdown__popover filter-dropdown__popover--${accent}`} role="listbox">
          {USAGE_RANGE_PRESETS.map((preset) => {
            const isActive = preset.id === value;
            return (
              <button
                key={preset.id}
                className={`filter-dropdown__option filter-dropdown__option--${accent}${isActive ? " is-active" : ""}`}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(preset.id)}
                type="button"
              >
                <span className="filter-dropdown__option-label">{preset.label}</span>
                <span className="filter-dropdown__option-meta">{preset.metaLabel}</span>
                {isActive && (
                  <svg
                    className={`filter-dropdown__check filter-dropdown__check--${accent}`}
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="filter-dropdown__footer">
            {isLoading ? "Computing usage range..." : "Filters usage period shown"}
          </div>
        </div>
      )}
    </div>
  );
}
