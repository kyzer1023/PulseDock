import type { ProviderSnapshot } from "@domain/dashboard";
import {
  formatCurrency,
  formatRelativeTime,
  formatTokens,
} from "@renderer/lib/formatters";
import chatgptIcon from "@renderer/assets/chatgpt.png";
import cursorIcon from "@renderer/assets/cursor.png";
import { formatQuotaMeterMeta, formatQuotaMeterValue, getQuotaMeterPercent } from "@domain/quota";
import { MeterBar } from "./MeterBar";

interface ProviderDetailPanelProps {
  provider: ProviderSnapshot;
  onDashboard: () => void | Promise<void>;
  filterSlot?: React.ReactNode;
}

function getAccent(provider: ProviderSnapshot): "codex" | "cursor" {
  return provider.id === "codex" ? "codex" : "cursor";
}

function getUsageBreakdown(provider: ProviderSnapshot) {
  if (provider.id === "cursor") {
    const input = Math.max(provider.inputTokens, 0);
    const cacheWrite = Math.max(provider.cacheWriteTokens, 0);
    const cacheRead = Math.max(provider.cachedInputTokens, 0);
    const output = Math.max(provider.outputTokens, 0);
    const total = Math.max(input + cacheWrite + cacheRead + output, 1);

    return [
      {
        key: "input",
        label: "Input",
        value: formatTokens(input),
        sublabel: `${Math.round((input / total) * 100)}% of total tokens`,
        percent: (input / total) * 100,
      },
      {
        key: "cache-write",
        label: "Cache Write",
        value: formatTokens(cacheWrite),
        sublabel: `${Math.round((cacheWrite / total) * 100)}% of total tokens`,
        percent: (cacheWrite / total) * 100,
      },
      {
        key: "cache-read",
        label: "Cache Read",
        value: formatTokens(cacheRead),
        sublabel: `${Math.round((cacheRead / total) * 100)}% of total tokens`,
        percent: (cacheRead / total) * 100,
      },
      {
        key: "output",
        label: "Output",
        value: formatTokens(output),
        sublabel: `${Math.round((output / total) * 100)}% of total tokens`,
        percent: (output / total) * 100,
      },
    ];
  }

  const nonCachedInput = Math.max(provider.inputTokens - provider.cachedInputTokens, 0);
  const cachedInput = Math.max(provider.cachedInputTokens, 0);
  const output = Math.max(provider.outputTokens + provider.reasoningTokens, 0);
  const total = Math.max(nonCachedInput + cachedInput + output, 1);

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
      label: provider.reasoningTokens > 0 ? "Output + Reasoning" : "Output",
      value: formatTokens(output),
      sublabel: `${Math.round((output / total) * 100)}% of total tokens`,
      percent: (output / total) * 100,
    },
  ];
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

export function ProviderDetailPanel({
  provider,
  onDashboard,
  filterSlot,
}: ProviderDetailPanelProps) {
  const accent = getAccent(provider);
  const hasData =
    provider.status === "fresh" || provider.status === "warning" || provider.status === "stale";
  const usageBreakdown = getUsageBreakdown(provider);
  const icon = provider.id === "codex" ? chatgptIcon : cursorIcon;
  const hasQuotaSection =
    provider.quotaMeters.length > 0 ||
    provider.quotaStatus !== "unsupported" ||
    provider.quotaStatusMessage !== null;

  return (
    <section className="provider-detail">
      <div className="provider-detail__hero">
        <div className="provider-detail__title-row">
          <img alt="" className="provider-detail__logo" src={icon} />
          <div className="provider-detail__title-copy">
            <h2 className="provider-detail__title">{provider.displayName}</h2>
            <div className="provider-detail__meta">
              <span className="provider-detail__meta-item">
                <span className={`provider-detail__dot provider-detail__dot--${accent}`} />
                <span>Updated {formatRelativeTime(provider.lastRefreshedAt)}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="provider-detail__hero-actions">
          <div className={`provider-detail__badge provider-detail__badge--${accent}`}>
            {provider.topLabel ?? provider.status.toUpperCase()}
          </div>
          {filterSlot}
        </div>
      </div>

      {hasQuotaSection ? (
        <div className="provider-detail__section">
          <div className="provider-detail__section-label">Quota</div>
          <div className="quota-meters">
            {provider.quotaMeters.map((meter) => (
              <MeterBar
                accent={accent}
                key={meter.id}
                label={meter.label}
                meta={formatQuotaMeterMeta(meter)}
                percent={getQuotaMeterPercent(meter)}
                value={formatQuotaMeterValue(meter)}
                variant="quota"
              />
            ))}
          </div>
          {provider.quotaMeters.length === 0 && provider.quotaStatusMessage ? (
            <div className="provider-detail__note">{provider.quotaStatusMessage}</div>
          ) : null}
        </div>
      ) : null}

      {hasData ? (
        <>
          <div className="provider-detail__section">
            <div className="provider-detail__section-label">Usage</div>
            <div className="usage-bars">
              {usageBreakdown.map((item) => (
                <MeterBar
                  accent={accent}
                  key={item.key}
                  label={item.label}
                  meta={item.sublabel}
                  minPercent={1}
                  percent={item.percent}
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
          <span>Dashboard</span>
          <ExternalLinkIcon />
        </button>
      </div>
    </section>
  );
}
