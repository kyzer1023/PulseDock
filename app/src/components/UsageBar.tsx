interface UsageBarProps {
  accent: "codex" | "cursor";
  label: string;
  sublabel: string;
  value: string;
  percent: number;
}

export function UsageBar({ accent, label, sublabel, value, percent }: UsageBarProps) {
  return (
    <div className="usage-bar">
      <div className="usage-bar__row">
        <span className="usage-bar__label">{label}</span>
        <span className={`usage-bar__value usage-bar__value--${accent}`}>{value}</span>
      </div>
      <div className="usage-bar__track">
        <div
          className={`usage-bar__fill usage-bar__fill--${accent}`}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>
      <div className="usage-bar__meta">{sublabel}</div>
    </div>
  );
}
