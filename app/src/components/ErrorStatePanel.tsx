interface ErrorStatePanelProps {
  message: string;
}

export function ErrorStatePanel({ message }: ErrorStatePanelProps) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <span className="state-panel__eyebrow">Recovery needed</span>
      <h2 className="state-panel__title">Could not load provider data</h2>
      <p className="state-panel__copy">{message}</p>
    </section>
  );
}
