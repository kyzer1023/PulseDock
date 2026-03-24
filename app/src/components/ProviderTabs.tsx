import type { ProviderId, ProviderSnapshot } from "@domain/dashboard";
import chatgptIcon from "@renderer/assets/chatgpt.png";
import cursorIcon from "@renderer/assets/cursor.png";

interface ProviderTabsProps {
  activeProviderId: ProviderId;
  providers: ProviderSnapshot[];
  onSelect: (providerId: ProviderId) => void;
}

const icons: Record<ProviderId, string> = {
  codex: chatgptIcon,
  cursor: cursorIcon,
};

export function ProviderTabs({
  activeProviderId,
  providers,
  onSelect,
}: ProviderTabsProps) {
  return (
    <nav className="provider-tabs">
      {providers.map((provider) => {
        const isActive = provider.id === activeProviderId;

        return (
          <button
            className={`provider-tab provider-tab--${provider.id}${isActive ? " is-active" : ""}`}
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            type="button"
          >
            <img
              alt=""
              className="provider-tab__icon"
              src={icons[provider.id]}
            />
            <span>{provider.displayName}</span>
          </button>
        );
      })}
    </nav>
  );
}
