export function LoadingCard() {
  return (
    <div className="detail-loading">
      <div className="detail-loading__header">
        <div className="skeleton detail-loading__icon" />
        <div className="skeleton detail-loading__title" />
      </div>
      <div className="skeleton detail-loading__bar" />
      <div className="skeleton detail-loading__bar" />
      <div className="skeleton detail-loading__bar" />
      <div className="detail-loading__row">
        <div className="skeleton detail-loading__cell" />
        <div className="skeleton detail-loading__cell" />
      </div>
    </div>
  );
}
