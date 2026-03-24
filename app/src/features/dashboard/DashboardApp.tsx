import { useEffect, useState } from "react";
import { EmptyStatePanel } from "@renderer/components/EmptyStatePanel";
import { ErrorStatePanel } from "@renderer/components/ErrorStatePanel";
import { FooterMeta } from "@renderer/components/FooterMeta";
import { LoadingCard } from "@renderer/components/LoadingCard";
import { PopupHeader } from "@renderer/components/PopupHeader";
import { ProviderDetailPanel } from "@renderer/components/ProviderDetailPanel";
import { ProviderTabs } from "@renderer/components/ProviderTabs";
import { StatusStrip } from "@renderer/components/StatusStrip";
import type { ProviderId } from "@domain/dashboard";
import { useDashboard } from "./use-dashboard";

export function DashboardApp() {
  const { bridgeError, openExternal, quitApp, refresh, snapshot } = useDashboard();
  const [activeProviderId, setActiveProviderId] = useState<ProviderId>("codex");

  const isLoading = snapshot === null || snapshot.loadingState === "loading";
  const providers = snapshot?.providers ?? [];
  const hasProviders = providers.length > 0;
  const allProvidersError = hasProviders && providers.every((provider) => provider.status === "error");
  const allProvidersEmpty = hasProviders && providers.every((provider) => provider.status === "empty");
  const topNotice = snapshot?.notices[0] ?? null;
  const showStatusStrip = topNotice !== null && !bridgeError && !allProvidersError;
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    if (!providers.some((provider) => provider.id === activeProviderId)) {
      const firstProvider = providers[0];
      if (firstProvider) {
        setActiveProviderId(firstProvider.id);
      }
    }
  }, [activeProviderId, providers]);

  function getDashboardUrl(providerId: ProviderId): string {
    return providerId === "codex"
      ? "https://platform.openai.com/usage"
      : "https://www.cursor.com/settings";
  }

  return (
    <main className="tray-shell">
      <div className="shell-glow shell-glow--one" />
      <div className="shell-glow shell-glow--two" />
      <div className="shell-frame">
        <PopupHeader
          isRefreshing={snapshot?.loadingState === "refreshing"}
          onRefresh={refresh}
        />

        {bridgeError ? <ErrorStatePanel message={bridgeError} /> : null}

        {allProvidersError && !bridgeError ? (
          <ErrorStatePanel
            message="Both providers failed. Try refreshing again after checking local auth and session files."
          />
        ) : null}

        {allProvidersEmpty && !bridgeError ? <EmptyStatePanel /> : null}

        {showStatusStrip && topNotice ? <StatusStrip notice={topNotice} /> : null}

        <section className="provider-stack provider-stack--tabs">
          {hasProviders ? (
            <ProviderTabs
              activeProviderId={activeProviderId}
              onSelect={setActiveProviderId}
              providers={providers}
            />
          ) : null}

          {isLoading && !hasProviders ? (
            <>
              <LoadingCard />
              <LoadingCard />
            </>
          ) : activeProvider ? (
            <ProviderDetailPanel
              onDashboard={() => openExternal(getDashboardUrl(activeProvider.id))}
              onQuit={quitApp}
              onRefresh={refresh}
              provider={activeProvider}
            />
          ) : (
            <EmptyStatePanel />
          )}
        </section>

        <FooterMeta
          lastRefreshedAt={snapshot?.lastRefreshedAt ?? null}
          provenance={snapshot?.provenance ?? []}
        />
      </div>
    </main>
  );
}
