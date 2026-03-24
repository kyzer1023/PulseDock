interface MetricCellProps {
  label: string;
  value: string;
}

export function MetricCell({ label, value }: MetricCellProps) {
  return (
    <div className="metric-cell">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
