export function EmptyStatePanel() {
  return (
    <section className="state-panel state-panel--empty">
      <p className="state-panel__eyebrow">First run</p>
      <h2 className="state-panel__title">No provider data loaded yet</h2>
      <p className="state-panel__copy">
        Codex needs local session files. Cursor needs desktop auth and export data.
      </p>
    </section>
  );
}
