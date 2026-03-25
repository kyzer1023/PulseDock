import { useState } from "react";
import type { ProviderId } from "@domain/dashboard";
import { EmptyStatePanel } from "@renderer/components/EmptyStatePanel";
import { ErrorStatePanel } from "@renderer/components/ErrorStatePanel";
import { FooterMeta } from "@renderer/components/FooterMeta";
import { LoadingCard } from "@renderer/components/LoadingCard";
import { PopupHeader } from "@renderer/components/PopupHeader";
import { ProviderDetailPanel } from "@renderer/components/ProviderDetailPanel";
import { ProviderTabs } from "@renderer/components/ProviderTabs";
import { StatusStrip } from "@renderer/components/StatusStrip";
import { SummaryBar } from "@renderer/components/SummaryBar";
import { useTheme } from "@renderer/hooks/use-theme";
import { useDashboard } from "./use-dashboard";

const DASHBOARD_URLS: Record<ProviderId, string> = {
  codex: "https://chatgpt.com/codex/settings/usage",
  cursor: "https://cursor.com/dashboard/usage",
};

export function DashboardApp() {
  const { bridgeError, openExternal, quitApp, refresh, snapshot } = useDashboard();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ProviderId>("codex");

  const isLoading = snapshot === null || snapshot.loadingState === "loading";
  const providers = snapshot?.providers ?? [];
  const hasProviders = providers.length > 0;
  const allProvidersError = hasProviders && providers.every((p) => p.status === "error");
  const topNotice = snapshot?.notices[0] ?? null;
  const showRecovery = bridgeError !== null || allProvidersError;

  const activeProvider = providers.find((p) => p.id === activeTab) ?? providers[0] ?? null;

  return (
    <main className="tray-shell">
      <PopupHeader
        isRefreshing={snapshot?.loadingState === "refreshing"}
        theme={theme}
        onRefresh={refresh}
        onToggleTheme={toggleTheme}
        onQuit={quitApp}
      />

      <SummaryBar summary={snapshot?.summary ?? null} isLoading={isLoading} />

      {showRecovery ? (
        <ErrorStatePanel
          message={
            bridgeError ??
            "Both providers failed. Try refreshing after checking local auth and session files."
          }
        />
      ) : hasProviders ? (
        <>
          <ProviderTabs
            activeProviderId={activeTab}
            providers={providers}
            onSelect={setActiveTab}
          />
          {activeProvider ? (
            <ProviderDetailPanel
              provider={activeProvider}
              onDashboard={() => openExternal(DASHBOARD_URLS[activeProvider.id])}
            />
          ) : null}
        </>
      ) : isLoading ? (
        <LoadingCard />
      ) : (
        <EmptyStatePanel />
      )}

      {!showRecovery && topNotice ? <StatusStrip notice={topNotice} /> : null}

      <FooterMeta
        lastRefreshedAt={snapshot?.lastRefreshedAt ?? null}
        providers={snapshot?.providers ?? []}
      />
    </main>
  );
}
