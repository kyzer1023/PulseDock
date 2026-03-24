import type { Theme } from "@renderer/hooks/use-theme";

interface PopupHeaderProps {
  isRefreshing: boolean;
  theme: Theme;
  onRefresh: () => void | Promise<void>;
  onToggleTheme: () => void;
  onQuit: () => void | Promise<void>;
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="refresh-icon" viewBox="0 0 24 24">
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

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function PopupHeader({
  isRefreshing,
  theme,
  onRefresh,
  onToggleTheme,
  onQuit,
}: PopupHeaderProps) {
  return (
    <header className="popup-header">
      <div className="popup-header__left">
        <h1 className="popup-header__title">PulseDock</h1>
        <p className="popup-header__sub">Local AI usage monitor</p>
      </div>
      <div className="popup-header__actions">
        <button
          aria-label="Refresh usage data"
          className={`refresh-button${isRefreshing ? " is-spinning" : ""}`}
          onClick={() => void onRefresh()}
          type="button"
        >
          <RefreshIcon />
          <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
        </button>
        <button
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="icon-button"
          onClick={onToggleTheme}
          type="button"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          aria-label="Quit PulseDock"
          className="icon-button icon-button--danger"
          onClick={() => void onQuit()}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
