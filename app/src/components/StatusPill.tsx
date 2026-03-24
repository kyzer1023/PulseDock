import type { ProviderStatus } from "@domain/dashboard";

interface StatusPillProps {
  status: ProviderStatus;
}

const labels: Record<ProviderStatus, string> = {
  empty: "Empty",
  error: "Error",
  fresh: "Fresh",
  stale: "Stale",
  warning: "Warning",
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`status-pill status-pill--${status}`}>{labels[status]}</span>;
}
