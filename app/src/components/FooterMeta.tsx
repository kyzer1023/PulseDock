import { formatRelativeTime } from "@renderer/lib/formatters";

interface FooterMetaProps {
  lastRefreshedAt: string | null;
  provenance: string[];
}

export function FooterMeta({ lastRefreshedAt, provenance }: FooterMetaProps) {
  return (
    <footer className="footer-meta">
      <span>Last refreshed {formatRelativeTime(lastRefreshedAt)}</span>
      <span>{provenance.join(" + ") || "Waiting for provider provenance"}</span>
    </footer>
  );
}
