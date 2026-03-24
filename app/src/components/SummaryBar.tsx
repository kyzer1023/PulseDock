import type { DashboardSummary } from "@domain/dashboard";
import { formatCurrency, formatTokens } from "@renderer/lib/formatters";

interface SummaryBarProps {
  summary: DashboardSummary | null;
  isLoading: boolean;
}

export function SummaryBar({ summary, isLoading }: SummaryBarProps) {
  if (isLoading || !summary) {
    return (
      <div className="summary-bar">
        <div className="summary-bar__cell">
          <span className="summary-bar__label">Est. cost</span>
          <span className="summary-bar__value">--</span>
        </div>
        <div className="summary-bar__cell">
          <span className="summary-bar__label">Tokens</span>
          <span className="summary-bar__value">--</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="summary-bar">
        <div className="summary-bar__cell">
          <span className="summary-bar__label">Est. cost</span>
          <span className="summary-bar__value">{formatCurrency(summary.estimatedCost)}</span>
        </div>
        <div className="summary-bar__cell">
          <span className="summary-bar__label">Tokens</span>
          <span className="summary-bar__value">{formatTokens(summary.totalTokens)}</span>
        </div>
      </div>
      <div className="summary-bar__footer">
        <span>{summary.usageWindow.label}</span>
        <span>{summary.loadedProviderCount} of {summary.providerCount} loaded</span>
      </div>
    </>
  );
}
