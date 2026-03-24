import {
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_PRICING_MODE,
} from "codexstats/dist/config.js";
import { aggregateModels } from "codexstats/dist/aggregate/models.js";
import { aggregateSources } from "codexstats/dist/aggregate/sources.js";
import { aggregateSummary } from "codexstats/dist/aggregate/summary.js";
import { discoverRolloutFiles, sessionIdFromPath } from "codexstats/dist/codex/discovery.js";
import { resolveCodexHome } from "codexstats/dist/codex/home.js";
import { loadSessionFile } from "codexstats/dist/codex/loader.js";
import { normalizeSession } from "codexstats/dist/codex/usage-normalizer.js";
import { createBundledPricingSource } from "codexstats/dist/pricing/bundled-snapshot.js";
import { priceEvents } from "codexstats/dist/pricing/estimate.js";
import { resolveDefaultTimezone } from "codexstats/dist/utils/dates.js";
import type { NormalizedUsageEvent } from "codexstats/dist/types.js";
import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import { mapCodexWarnings } from "../shared/warning-text.js";

function hasEventInRange(events: NormalizedUsageEvent[], since: string, until: string): boolean {
  return events.some((event) => event.localDateKey >= since && event.localDateKey <= until);
}

function createEmptySnapshot(
  context: ProviderContext,
  detailMessage: string,
): ProviderSnapshot {
  const window = createRecentDateWindow(context.now);

  return {
    id: "codex",
    displayName: "Codex",
    status: "empty",
    usageWindow: window.usageWindow,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "model",
    activityCount: 0,
    activityLabel: "Sessions",
    warnings: [],
    lastRefreshedAt: context.now.toISOString(),
    staleSince: null,
    provenance: ["Codex local sessions"],
    detailMessage,
  };
}

export const codexProvider: UsageProvider = {
  id: "codex",
  displayName: "Codex",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const dateWindow = createRecentDateWindow(context.now);
    const timezone = resolveDefaultTimezone();
    const codexHome = resolveCodexHome(undefined, process.env);
    const rolloutFiles = await discoverRolloutFiles(codexHome);

    if (rolloutFiles.length === 0) {
      return createEmptySnapshot(context, "No Codex session data was found under the local Codex home.");
    }

    const loadedFiles = await Promise.all(
      rolloutFiles.map((filePath) => loadSessionFile(filePath, sessionIdFromPath(codexHome, filePath))),
    );
    const normalized = loadedFiles.map((file) =>
      normalizeSession(file, {
        timezone,
        fallbackModel: DEFAULT_FALLBACK_MODEL,
      }),
    );

    const filteredEvents = normalized
      .flatMap((entry) => entry.events)
      .filter(
        (event) =>
          event.localDateKey >= dateWindow.codexSince && event.localDateKey <= dateWindow.codexUntil,
      );

    if (filteredEvents.length === 0) {
      return createEmptySnapshot(
        context,
        `No measurable Codex activity was found for ${dateWindow.usageWindow.label.toLowerCase()}.`,
      );
    }

    const sessionsInRange = normalized
      .filter((entry) => hasEventInRange(entry.events, dateWindow.codexSince, dateWindow.codexUntil))
      .map((entry) => entry.session);

    const pricedEvents = priceEvents(
      filteredEvents,
      DEFAULT_PRICING_MODE,
      createBundledPricingSource(),
    );
    const summary = aggregateSummary(pricedEvents, sessionsInRange.length);
    const models = aggregateModels(pricedEvents);
    const sources = aggregateSources(pricedEvents);
    const warnings = mapCodexWarnings(
      new Set([
        ...summary.warnings,
        ...sessionsInRange.flatMap((session) => session.warnings),
        ...loadedFiles.flatMap((file) => file.warnings),
      ]),
    );
    const topModel = models[0]?.model ?? null;
    const topSource = sources[0]?.source ?? null;

    return {
      id: "codex",
      displayName: "Codex",
      status: warnings.length > 0 ? "warning" : "fresh",
      usageWindow: dateWindow.usageWindow,
      inputTokens: summary.inputTokens,
      cachedInputTokens: summary.cachedInputTokens,
      outputTokens: summary.outputTokens,
      reasoningTokens: summary.reasoningOutputTokens,
      totalTokens: summary.totalTokens,
      estimatedCost: summary.estimatedCost,
      topLabel: topModel ?? topSource,
      topLabelType: topModel ? "model" : "source",
      activityCount: summary.measurableSessionCount,
      activityLabel: "Sessions",
      warnings,
      lastRefreshedAt: context.now.toISOString(),
      staleSince: null,
      provenance: ["Codex local sessions"],
      detailMessage: null,
    };
  },
};
