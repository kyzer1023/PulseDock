interface ErrorStatePanelProps {
  message: string;
}

export function ErrorStatePanel({ message }: ErrorStatePanelProps) {
  return (
    <section className="state-panel state-panel--error">
      <p className="state-panel__eyebrow">Recovery needed</p>
      <h2 className="state-panel__title">PulseDock could not load provider data</h2>
      <p className="state-panel__copy">{message}</p>
    </section>
  );
}
