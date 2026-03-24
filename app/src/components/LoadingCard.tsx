export function LoadingCard() {
  return (
    <article className="provider-card provider-card--loading">
      <div className="provider-card__header">
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--pill" />
      </div>
      <div className="skeleton skeleton--cost" />
      <div className="provider-metrics">
        <div className="skeleton skeleton--metric" />
        <div className="skeleton skeleton--metric" />
        <div className="skeleton skeleton--metric" />
        <div className="skeleton skeleton--metric" />
      </div>
    </article>
  );
}
