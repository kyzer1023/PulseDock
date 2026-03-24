import type { ProviderId, ProviderSnapshot } from "@domain/dashboard";

interface ProviderTabsProps {
  activeProviderId: ProviderId;
  providers: ProviderSnapshot[];
  onSelect: (providerId: ProviderId) => void;
}

export function ProviderTabs({
  activeProviderId,
  providers,
  onSelect,
}: ProviderTabsProps) {
  return (
    <section className="provider-tabs">
      <div className="provider-tabs__inner">
        {providers.map((provider) => {
          const isActive = provider.id === activeProviderId;

          return (
            <button
              className={`provider-tab provider-tab--${provider.id}${isActive ? " is-active" : ""}`}
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              type="button"
            >
              <span className="provider-tab__glyph" aria-hidden="true">
                {provider.id === "codex" ? "C" : "R"}
              </span>
              <span className="provider-tab__label">{provider.displayName}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
