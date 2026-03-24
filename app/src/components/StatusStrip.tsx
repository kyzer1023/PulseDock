import type { DashboardNotice } from "@domain/dashboard";

interface StatusStripProps {
  notice: DashboardNotice;
}

export function StatusStrip({ notice }: StatusStripProps) {
  return (
    <section className={`status-strip status-strip--${notice.level}`} role="status">
      <span className="status-strip__eyebrow">
        {notice.level === "error" ? "Recovery needed" : "Status"}
      </span>
      <p className="status-strip__message">{notice.message}</p>
    </section>
  );
}
