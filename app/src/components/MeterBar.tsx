interface MeterBarProps {
  accent: "codex" | "cursor";
  label: string;
  meta: string;
  minPercent?: number;
  percent: number;
  value: string;
  variant?: "default" | "quota";
}

export function MeterBar({
  accent,
  label,
  meta,
  minPercent = 0,
  percent,
  value,
  variant = "default",
}: MeterBarProps) {
  const clampedPercent = Math.max(percent, minPercent);

  return (
    <div className={`meter-bar${variant === "quota" ? " meter-bar--quota" : ""}`}>
      <div className="meter-bar__row">
        <span className="meter-bar__label">{label}</span>
        <span className={`meter-bar__value meter-bar__value--${accent}`}>{value}</span>
      </div>
      <div className="meter-bar__track">
        <div
          className={`meter-bar__fill meter-bar__fill--${accent}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <div className="meter-bar__meta">{meta}</div>
    </div>
  );
}
