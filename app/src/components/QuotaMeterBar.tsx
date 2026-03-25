import type { QuotaMeter } from "@domain/dashboard";
import { formatQuotaMeterMeta, formatQuotaMeterValue, getQuotaMeterPercent } from "@domain/quota";

interface QuotaMeterBarProps {
  meter: QuotaMeter;
  accent: "codex" | "cursor";
}

export function QuotaMeterBar({ meter, accent }: QuotaMeterBarProps) {
  const percent = getQuotaMeterPercent(meter);

  return (
    <div className="quota-meter">
      <div className="quota-meter__row">
        <span className="quota-meter__label">{meter.label}</span>
        <span className={`quota-meter__value quota-meter__value--${accent}`}>
          {formatQuotaMeterValue(meter)}
        </span>
      </div>
      <div className="quota-meter__track">
        <div
          className={`quota-meter__fill quota-meter__fill--${accent}`}
          style={{ width: `${Math.max(percent, 0)}%` }}
        />
      </div>
      <div className="quota-meter__meta">{formatQuotaMeterMeta(meter)}</div>
    </div>
  );
}
