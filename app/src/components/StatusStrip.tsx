import type { DashboardNotice } from "@domain/dashboard";

interface StatusStripProps {
  notice: DashboardNotice;
}

export function StatusStrip({ notice }: StatusStripProps) {
  return <section className={`status-strip status-strip--${notice.level}`}>{notice.message}</section>;
}
