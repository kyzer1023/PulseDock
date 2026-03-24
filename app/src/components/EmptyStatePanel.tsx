export function EmptyStatePanel() {
  return (
    <section className="state-panel state-panel--empty">
      <span className="state-panel__eyebrow">First run</span>
      <h2 className="state-panel__title">No provider data loaded yet</h2>
      <p className="state-panel__copy">
        Codex looks for local session files. Cursor looks for desktop auth and export data.
      </p>
    </section>
  );
}
