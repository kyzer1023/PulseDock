import type { DashboardSummary } from "@domain/dashboard";
import { formatCurrency, formatTokens } from "@renderer/lib/formatters";

interface SummaryHeroProps {
  isEmpty: boolean;
  isLoading: boolean;
  summary: DashboardSummary | null;
}

export function SummaryHero({ isEmpty, isLoading, summary }: SummaryHeroProps) {
  if (isLoading || !summary) {
    return (
      <section className="summary-hero summary-hero--loading">
        <div className="hero-loading-line hero-loading-line--large" />
        <div className="hero-loading-grid">
          <div className="hero-loading-line" />
          <div className="hero-loading-line" />
        </div>
      </section>
    );
  }

  if (isEmpty) {
    return (
      <section className="summary-hero summary-hero--empty">
        <p className="summary-kicker">No usage loaded yet</p>
        <h2 className="summary-empty-title">Waiting for local provider data</h2>
        <p className="summary-empty-copy">
          PulseDock is ready. The provider cards below show what each adapter expects to find.
        </p>
      </section>
    );
  }

  return (
    <section className="summary-hero">
      <div className="summary-top-row">
        <div>
          <p className="summary-label">Total est. cost</p>
          <p className="summary-primary">{formatCurrency(summary.estimatedCost)}</p>
        </div>
        <div className="summary-right">
          <p className="summary-label">Total tokens</p>
          <p className="summary-secondary">{formatTokens(summary.totalTokens)}</p>
        </div>
      </div>
      <div className="summary-footer-row">
        <span>{summary.usageWindow.label}</span>
        <span>
          {summary.loadedProviderCount} of {summary.providerCount} providers loaded
        </span>
      </div>
    </section>
  );
}
