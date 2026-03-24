import type { ProviderSnapshot } from "@domain/dashboard";
import {
  formatCurrency,
  formatRelativeTime,
  formatTokens,
} from "@renderer/lib/formatters";
import chatgptIcon from "@renderer/assets/chatgpt.png";
import cursorIcon from "@renderer/assets/cursor.png";
import { UsageBar } from "./UsageBar";

interface ProviderDetailPanelProps {
  provider: ProviderSnapshot;
  onDashboard: () => void | Promise<void>;
  onQuit: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}

function getAccent(provider: ProviderSnapshot): "codex" | "cursor" {
  return provider.id === "codex" ? "codex" : "cursor";
}

function getUsageBreakdown(provider: ProviderSnapshot) {
  const total = Math.max(provider.totalTokens, 1);
  const nonCachedInput = Math.max(provider.inputTokens - provider.cachedInputTokens, 0);
  const cachedInput = Math.max(provider.cachedInputTokens, 0);
  const output = Math.max(provider.outputTokens + provider.reasoningTokens, 0);

  return [
    {
      key: "input",
      label: "Input",
      value: formatTokens(nonCachedInput),
      sublabel: `${Math.round((nonCachedInput / total) * 100)}% of total tokens`,
      percent: (nonCachedInput / total) * 100,
    },
    {
      key: "cached",
      label: "Cached",
      value: formatTokens(cachedInput),
      sublabel: `${Math.round((cachedInput / total) * 100)}% of total tokens`,
      percent: (cachedInput / total) * 100,
    },
    {
      key: "output",
      label: provider.reasoningTokens > 0 ? "Output + reasoning" : "Output",
      value: formatTokens(output),
      sublabel: `${Math.round((output / total) * 100)}% of total tokens`,
      percent: (output / total) * 100,
    },
  ];
}

export function ProviderDetailPanel({
  provider,
  onDashboard,
  onQuit,
  onRefresh,
}: ProviderDetailPanelProps) {
  const accent = getAccent(provider);
  const hasData =
    provider.status === "fresh" || provider.status === "warning" || provider.status === "stale";
  const usageBreakdown = getUsageBreakdown(provider);
  const icon = provider.id === "codex" ? chatgptIcon : cursorIcon;

  return (
    <section className="provider-detail">
      <div className="provider-detail__hero">
        <div className="provider-detail__title-row">
          <img alt="" className="provider-detail__logo" src={icon} />
          <div>
            <h2 className="provider-detail__title">{provider.displayName}</h2>
            <div className="provider-detail__meta">
              <span className={`provider-detail__dot provider-detail__dot--${accent}`} />
              <span>Updated {formatRelativeTime(provider.lastRefreshedAt)}</span>
              <span>{provider.provenance[0] ?? "provider"}</span>
            </div>
          </div>
        </div>

        <div className={`provider-detail__badge provider-detail__badge--${accent}`}>
          {provider.topLabel ?? provider.status.toUpperCase()}
        </div>
      </div>

      {hasData ? (
        <>
          <div className="provider-detail__section">
            <div className="provider-detail__section-label">Usage</div>
            <div className="usage-bars">
              {usageBreakdown.map((item) => (
                <UsageBar
                  accent={accent}
                  key={item.key}
                  label={item.label}
                  percent={item.percent}
                  sublabel={item.sublabel}
                  value={item.value}
                />
              ))}
            </div>
          </div>

          <div className="provider-detail__section">
            <div className="provider-detail__section-label">Cost</div>
            <div className="detail-card">
              <div className="detail-row">
                <span>Estimated cost</span>
                <strong>{formatCurrency(provider.estimatedCost)}</strong>
              </div>
              <div className="detail-row">
                <span>{provider.activityLabel}</span>
                <strong>{provider.activityCount}</strong>
              </div>
              <div className="detail-row">
                <span>{provider.topLabelType === "provider" ? "Top provider" : "Top model"}</span>
                <strong>{provider.topLabel ?? "n/a"}</strong>
              </div>
              <div className="detail-row">
                <span>Total tokens</span>
                <strong>{formatTokens(provider.totalTokens)}</strong>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="provider-detail__empty">
          <h3>{provider.status === "error" ? "Provider refresh failed" : "No provider data yet"}</h3>
          <p>{provider.detailMessage ?? "No details available."}</p>
        </div>
      )}

      {provider.warnings[0] ? (
        <div className="provider-detail__warning">{provider.warnings[0]}</div>
      ) : null}

      <div className="provider-detail__footer">
        <button className="footer-link" onClick={() => void onDashboard()} type="button">
          Dashboard
        </button>
        <div className="provider-detail__footer-actions">
          <button
            className={`footer-button footer-button--${accent}`}
            onClick={() => void onRefresh()}
            type="button"
          >
            Refresh
          </button>
          <button className="footer-ghost" onClick={() => void onQuit()} type="button">
            Quit
          </button>
        </div>
      </div>
    </section>
  );
}
