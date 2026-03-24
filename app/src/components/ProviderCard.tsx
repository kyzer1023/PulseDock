import type { ProviderSnapshot } from "@domain/dashboard";
import { formatCurrency, formatRelativeTime, formatTokens } from "@renderer/lib/formatters";
import { MetricCell } from "./MetricCell";
import { StatusPill } from "./StatusPill";

interface ProviderCardProps {
  provider: ProviderSnapshot;
}

export function ProviderCard({ provider }: ProviderCardProps) {
  const isDataCard =
    provider.status === "fresh" || provider.status === "warning" || provider.status === "stale";

  return (
    <article className={`provider-card provider-card--${provider.status}`}>
      <div className="provider-card__header">
        <div>
          <p className="provider-badge">{provider.id.toUpperCase()}</p>
          <h3 className="provider-title">{provider.displayName}</h3>
        </div>
        <StatusPill status={provider.status} />
      </div>

      {isDataCard ? (
        <>
          <p className="provider-cost">{formatCurrency(provider.estimatedCost)}</p>
          <div className="provider-metrics">
            <MetricCell
              label="Total tokens"
              value={formatTokens(provider.totalTokens)}
            />
            <MetricCell
              label={provider.topLabelType === "provider" ? "Top provider" : "Top model"}
              value={provider.topLabel ?? "n/a"}
            />
            <MetricCell
              label={provider.activityLabel}
              value={provider.activityCount.toString()}
            />
            <MetricCell
              label="Updated"
              value={formatRelativeTime(provider.lastRefreshedAt)}
            />
          </div>
        </>
      ) : (
        <div className="provider-message-block">
          <p className="provider-message-title">
            {provider.status === "error" ? "Provider refresh failed" : "No provider data yet"}
          </p>
          <p className="provider-message-copy">{provider.detailMessage ?? "No details available."}</p>
        </div>
      )}

      {provider.warnings[0] ? (
        <p className="inline-warning">{provider.warnings[0]}</p>
      ) : null}
    </article>
  );
}
