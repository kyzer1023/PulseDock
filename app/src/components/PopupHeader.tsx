interface PopupHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      className="refresh-icon"
      viewBox="0 0 24 24"
    >
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M20 4v6h-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function PopupHeader({ isRefreshing, onRefresh }: PopupHeaderProps) {
  return (
    <header className="popup-header">
      <div>
        <p className="eyebrow">PulseDock</p>
        <h1 className="app-title">Local AI usage monitor</h1>
      </div>
      <button
        aria-label="Refresh usage data"
        className={`refresh-button${isRefreshing ? " is-spinning" : ""}`}
        onClick={() => void onRefresh()}
        type="button"
      >
        <RefreshIcon />
        <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
      </button>
    </header>
  );
}
