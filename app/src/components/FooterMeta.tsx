import type { ProviderSnapshot } from "@domain/dashboard";
import { formatRelativeTime } from "@renderer/lib/formatters";

interface FooterMetaProps {
  lastRefreshedAt: string | null;
  providers: ProviderSnapshot[];
}

function buildFooterSummary(providers: ProviderSnapshot[]): string {
  if (providers.length === 0) {
    return "Waiting for data";
  }

  const loadedCount = providers.filter((provider) =>
    provider.status === "fresh" || provider.status === "warning" || provider.status === "stale"
  ).length;
  const legacyRequestCount = providers.filter((provider) =>
    provider.quotaMeters.some((meter) => meter.id === "requests" || meter.unitLabel === "requests")
  ).length;
  const liveQuotaCount = providers.filter((provider) =>
    provider.quotaStatus === "available" &&
    provider.quotaMeters.some((meter) => !(meter.id === "requests" || meter.unitLabel === "requests"))
  ).length;
  const staleCount = providers.filter((provider) => provider.status === "stale").length;

  const parts = [`${loadedCount}/${providers.length} providers loaded`];

  if (liveQuotaCount > 0 || legacyRequestCount > 0) {
    const quotaParts: string[] = [];
    if (liveQuotaCount > 0) {
      quotaParts.push(`${liveQuotaCount} live quota`);
    }
    if (legacyRequestCount > 0) {
      quotaParts.push(`${legacyRequestCount} legacy requests`);
    }
    parts.push(quotaParts.join(", "));
  }

  if (staleCount > 0) {
    parts.push(`${staleCount} stale`);
  }

  return parts.join(" • ");
}

export function FooterMeta({ lastRefreshedAt, providers }: FooterMetaProps) {
  return (
    <footer className="footer-meta">
      <span>Updated {formatRelativeTime(lastRefreshedAt)}</span>
      <span>{buildFooterSummary(providers)}</span>
    </footer>
  );
}
