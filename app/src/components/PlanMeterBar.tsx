import type { PlanMeter } from "@domain/dashboard";

interface PlanMeterBarProps {
  meter: PlanMeter;
  accent: "codex" | "cursor";
}

export function PlanMeterBar({ meter, accent }: PlanMeterBarProps) {
  const isRequests = meter.unit === "requests";
  const percent = isRequests
    ? (meter.current / Math.max(meter.limit, 1)) * 100
    : meter.current;
  const clampedPercent = Math.min(Math.max(percent, 0), 100);

  return (
    <div className="plan-meter">
      <div className="plan-meter__row">
        <span className="plan-meter__label">{meter.label}</span>
        <span className={`plan-meter__value plan-meter__value--${accent}`}>
          {isRequests ? `${meter.current} / ${meter.limit}` : `${Math.round(meter.current)}%`}
        </span>
      </div>
      <div className="plan-meter__track">
        <div
          className={`plan-meter__fill plan-meter__fill--${accent}`}
          style={{ width: `${Math.max(clampedPercent, 1)}%` }}
        />
      </div>
      {isRequests ? (
        <div className="plan-meter__meta">{meter.resetLabel}</div>
      ) : (
        <div className="plan-meter__meta">{meter.resetLabel}</div>
      )}
    </div>
  );
}
