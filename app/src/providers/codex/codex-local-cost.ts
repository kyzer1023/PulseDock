import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { ProviderSnapshot, SectionAvailability, UsageWindow } from "../../domain/dashboard.js";
import type { UsageRangePresetId } from "../../domain/usage-range.js";
import { createUsageDateWindow } from "../shared/date-window.js";
import { mapCodexWarnings } from "../shared/warning-text.js";

interface UsageSnapshot {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface SessionSummary {
  sessionId: string;
  source: string;
  warnings: string[];
}

interface NormalizedUsageEvent extends UsageSnapshot {
  sessionId: string;
  timestamp: string;
  localDateKey: string;
  model: string;
  canonicalModel: string;
  source: string;
  warnings: string[];
}

interface ModelPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

interface ScannedSessionResult {
  session: SessionSummary;
  events: NormalizedUsageEvent[];
}

interface CodexScanCache {
  codexHome: string;
  timezone: string;
  discoveryWarnings: string[];
  scanned: ScannedSessionResult[];
}

export interface CodexLocalCostSnapshot {
  usageWindow: UsageWindow;
  inputTokens: number;
  cacheWriteTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
  topLabel: string | null;
  topLabelType: ProviderSnapshot["topLabelType"];
  activityCount: number;
  warnings: string[];
  detailMessage: string | null;
  provenance: string[];
  costStatus: SectionAvailability;
  costStatusMessage: string | null;
  costLastRefreshedAt: string | null;
  hasData: boolean;
}

const DEFAULT_FALLBACK_MODEL = "gpt-5-codex";
const CODEX_LOCAL_PROVENANCE = "Codex local sessions";
let codexScanCache: CodexScanCache | null = null;

const PRICING: Record<string, ModelPricing> = {
  "gpt-5": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 10 },
  "gpt-5-codex": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 10 },
  "gpt-5.1-codex": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 10 },
  "gpt-5.1-codex-mini": { inputPerMillionUsd: 0.25, cachedInputPerMillionUsd: 0.025, outputPerMillionUsd: 2 },
  "gpt-5.2-codex": { inputPerMillionUsd: 1.75, cachedInputPerMillionUsd: 0.175, outputPerMillionUsd: 14 },
  "gpt-5.3-codex": { inputPerMillionUsd: 1.75, cachedInputPerMillionUsd: 0.175, outputPerMillionUsd: 14 },
  "gpt-5-mini": { inputPerMillionUsd: 0.25, cachedInputPerMillionUsd: 0.025, outputPerMillionUsd: 2 },
  "gpt-5.4": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 15 },
  "codex-mini-latest": { inputPerMillionUsd: 1.5, cachedInputPerMillionUsd: 0.375, outputPerMillionUsd: 6 },
};

const EXACT_MODEL_MAP = new Map<string, string>([
  ["gpt-5", "gpt-5"],
  ["gpt-5-codex", "gpt-5-codex"],
  ["gpt-5.1-codex", "gpt-5.1-codex"],
  ["gpt-5.1-codex-mini", "gpt-5.1-codex-mini"],
  ["gpt-5.2-codex", "gpt-5.2-codex"],
  ["gpt-5.3-codex", "gpt-5.3-codex"],
  ["gpt-5-mini", "gpt-5-mini"],
  ["gpt-5 mini", "gpt-5-mini"],
  ["gpt-5.4", "gpt-5.4"],
  ["codex-mini-latest", "codex-mini-latest"],
]);

function getCodexLocalProvenance(): string[] {
  return [process.env.CODEX_HOME ? `${CODEX_LOCAL_PROVENANCE} (custom CODEX_HOME)` : CODEX_LOCAL_PROVENANCE];
}

function buildEmptyCodexCostSnapshot(options: {
  costLastRefreshedAt: string | null;
  detailMessage: string;
  hasWarnings?: boolean;
  statusMessage: string;
  usageWindow: UsageWindow;
  warnings: string[];
}): CodexLocalCostSnapshot {
  return {
    usageWindow: options.usageWindow,
    inputTokens: 0,
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "model",
    activityCount: 0,
    warnings: options.warnings,
    detailMessage: options.detailMessage,
    provenance: getCodexLocalProvenance(),
    costStatus: options.hasWarnings ? "stale" : "unsupported",
    costStatusMessage: options.statusMessage,
    costLastRefreshedAt: options.costLastRefreshedAt,
    hasData: false,
  };
}

function resolveDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const localDateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getLocalDateKeyFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = localDateKeyFormatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  localDateKeyFormatterCache.set(timezone, formatter);
  return formatter;
}

export function formatCodexLocalDateKey(timestamp: string, timezone: string): string {
  const formatter = getLocalDateKeyFormatter(timezone);
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }

  const formatted = formatter.format(new Date(timestamp));
  const numericParts = formatted.match(/\d+/g);
  if (numericParts && numericParts.length >= 3) {
    const [first, second, third] = numericParts;
    if (first && second && third) {
      const yearPart = [first, second, third].find((value) => value.length === 4) ?? third;
      const monthPart = yearPart === first ? second : first;
      const dayPart = yearPart === third ? second : third;
      return `${yearPart}-${monthPart.padStart(2, "0")}-${dayPart.padStart(2, "0")}`;
    }
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

function localDateKeyToLocalDate(dateKey: string): Date {
  return new Date(
    Number.parseInt(dateKey.slice(0, 4), 10),
    Number.parseInt(dateKey.slice(5, 7), 10) - 1,
    Number.parseInt(dateKey.slice(8, 10), 10),
  );
}

function toLocalDateKey(timestamp: string, timezone: string): string {
  return formatCodexLocalDateKey(timestamp, timezone);
}

function normalizePathSegments(targetPath: string): string {
  return targetPath.split(path.sep).join("/");
}

function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEX_HOME) {
    return path.resolve(env.CODEX_HOME);
  }

  return path.join(os.homedir(), ".codex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSnapshot(value: unknown): UsageSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = toNumber(value.input_tokens ?? value.inputTokens);
  const cachedInputTokens = toNumber(
    value.cached_input_tokens ??
      value.cachedInputTokens ??
      value.cache_read_input_tokens ??
      value.cacheReadInputTokens,
  );
  const outputTokens = toNumber(value.output_tokens ?? value.outputTokens);
  const reasoningOutputTokens = toNumber(value.reasoning_output_tokens ?? value.reasoningOutputTokens);
  const totalTokensRaw = value.total_tokens ?? value.totalTokens;
  const totalTokens =
    typeof totalTokensRaw === "number" && Number.isFinite(totalTokensRaw)
      ? totalTokensRaw
      : inputTokens + outputTokens;

  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    reasoningOutputTokens === 0 &&
    totalTokens === 0
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function diffSnapshot(current: UsageSnapshot, previous?: UsageSnapshot): UsageSnapshot {
  if (!previous) {
    return current;
  }

  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningOutputTokens: current.reasoningOutputTokens - previous.reasoningOutputTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
  };
}

function clampSnapshot(snapshot: UsageSnapshot): { snapshot: UsageSnapshot; regressed: boolean } {
  let regressed = false;
  const clamped: UsageSnapshot = { ...snapshot };

  for (const key of Object.keys(clamped) as Array<keyof UsageSnapshot>) {
    if (clamped[key] < 0) {
      clamped[key] = 0;
      regressed = true;
    }
  }

  return { snapshot: clamped, regressed };
}

function extractTokenCountPayload(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  if (entry.type === "token_count") {
    return entry;
  }

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "token_count") {
    return payload;
  }

  const nestedPayload = getNestedRecord(payload, "payload");
  if (nestedPayload?.type === "token_count") {
    return nestedPayload;
  }

  return undefined;
}

function extractUsageInfo(entry: Record<string, unknown>): {
  direct: UsageSnapshot | undefined;
  cumulative: UsageSnapshot | undefined;
  model: string | undefined;
} | null {
  const payload = extractTokenCountPayload(entry);
  if (!payload) {
    return null;
  }

  const info = getNestedRecord(payload, "info") ?? payload;
  const direct = normalizeSnapshot(info.last_token_usage) ?? normalizeSnapshot(info.lastTokenUsage);
  const cumulative = normalizeSnapshot(info.total_token_usage) ?? normalizeSnapshot(info.totalTokenUsage);
  const model =
    (typeof info.model === "string" ? info.model : undefined) ??
    (typeof payload.model === "string" ? payload.model : undefined);

  if (!direct && !cumulative) {
    return null;
  }

  return { direct, cumulative, model };
}

function extractTurnModel(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== "turn_context") {
    return undefined;
  }

  const payload = isRecord(entry.payload) ? entry.payload : entry;
  return typeof payload.model === "string" ? payload.model : undefined;
}

function toCanonicalModel(model: string): string {
  const normalized = model.trim().toLowerCase().replace(/\s+/g, "-");
  const exact = EXACT_MODEL_MAP.get(normalized);
  if (exact) {
    return exact;
  }

  for (const candidate of EXACT_MODEL_MAP.values()) {
    if (normalized.startsWith(`${candidate.toLowerCase()}-`)) {
      return candidate;
    }
  }

  return normalized;
}

function estimateCostForEvent(event: NormalizedUsageEvent): { estimatedCost: number; warnings: string[] } {
  const pricing = PRICING[event.canonicalModel];
  const warnings = [...event.warnings];

  if (!pricing) {
    warnings.push("unknown-model-pricing");
    return { estimatedCost: 0, warnings };
  }

  const nonCachedInputTokens = Math.max(0, event.inputTokens - event.cachedInputTokens);
  const estimatedCost =
    (nonCachedInputTokens * pricing.inputPerMillionUsd) / 1_000_000 +
    (event.cachedInputTokens * pricing.cachedInputPerMillionUsd) / 1_000_000 +
    (event.outputTokens * pricing.outputPerMillionUsd) / 1_000_000;

  return { estimatedCost, warnings };
}

function hasEventInRange(events: NormalizedUsageEvent[], since: string, until: string): boolean {
  return events.some((event) => event.localDateKey >= since && event.localDateKey <= until);
}

function aggregateByKey<T extends { estimatedCost: number; totalTokens: number }>(
  items: T[],
  getKey: (item: T) => string,
): Array<T & { key: string }> {
  const grouped = new Map<string, T>();

  for (const item of items) {
    const key = getKey(item);
    const current = grouped.get(key);
    if (current) {
      current.estimatedCost += item.estimatedCost;
      current.totalTokens += item.totalTokens;
    } else {
      grouped.set(key, { ...item });
    }
  }

  return Array.from(grouped.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => {
      const costDiff = right.estimatedCost - left.estimatedCost;
      if (costDiff !== 0) {
        return costDiff;
      }

      return right.totalTokens - left.totalTokens;
    });
}

async function discoverRolloutFiles(codexHome: string): Promise<{ files: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const sessionsRoot = path.join(codexHome, "sessions");

  try {
    await fs.access(sessionsRoot);
  } catch {
    return { files: [], warnings };
  }

  const stack = [sessionsRoot];
  const results: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      warnings.push("scan-read-failed");
      continue;
    }

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      if (!entry.isFile() || !/rollout-.*\.jsonl$/i.test(entry.name)) {
        continue;
      }

      results.push(nextPath);
    }
  }

  return {
    files: results.sort((left, right) => normalizePathSegments(right).localeCompare(normalizePathSegments(left))),
    warnings,
  };
}

async function scanSessionFile(
  absolutePath: string,
  sessionId: string,
  options: { timezone: string; fallbackModel: string },
): Promise<ScannedSessionResult> {
  const warnings: string[] = [];

  const events: NormalizedUsageEvent[] = [];
  let previousCumulative: UsageSnapshot | undefined;
  let currentModelHint: string | undefined;
  let source = "unknown";

  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    let rawEntry: unknown;
    try {
      rawEntry = JSON.parse(line);
    } catch {
      warnings.push("malformed-json-line");
      continue;
    }

    const entry = isRecord(rawEntry) ? rawEntry : {};

    if (entry.type === "session_meta") {
      const payload = isRecord(entry.payload) ? entry.payload : {};
      source = typeof payload.source === "string" && payload.source.length > 0 ? payload.source : source;
    }

    const turnModel = extractTurnModel(entry);
    if (turnModel) {
      currentModelHint = turnModel;
    }

    const usageInfo = extractUsageInfo(entry);
    if (!usageInfo) {
      continue;
    }

    const baseSnapshot = usageInfo.direct ?? diffSnapshot(usageInfo.cumulative!, previousCumulative);
    const { snapshot, regressed } = clampSnapshot(baseSnapshot);
    if (usageInfo.cumulative) {
      previousCumulative = usageInfo.cumulative;
    }

    const resolvedModel = [usageInfo.model, currentModelHint, options.fallbackModel].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    if (!resolvedModel) {
      warnings.push("missing-model");
      continue;
    }

    const timestamp =
      typeof entry.timestamp === "string" && entry.timestamp.length > 0
        ? entry.timestamp
        : new Date().toISOString();
    const eventWarnings: string[] = [];

    if (resolvedModel === options.fallbackModel && usageInfo.model === undefined && currentModelHint === undefined) {
      eventWarnings.push("fallback-model");
    }

    if (regressed) {
      eventWarnings.push("regressive-usage");
      warnings.push("regressive-usage");
    }

    events.push({
      sessionId,
      timestamp,
      localDateKey: toLocalDateKey(timestamp, options.timezone),
      model: resolvedModel.trim(),
      canonicalModel: toCanonicalModel(resolvedModel),
      source,
      inputTokens: snapshot.inputTokens,
      cachedInputTokens: snapshot.cachedInputTokens,
      outputTokens: snapshot.outputTokens,
      reasoningOutputTokens: snapshot.reasoningOutputTokens,
      totalTokens: snapshot.totalTokens,
      warnings: eventWarnings,
    });
  }

  if (events.length === 0) {
    warnings.push("unmeasurable-session");
  }

  return {
    session: {
      sessionId,
      source,
      warnings,
    },
    events,
  };
}

function summarizeEvents(events: Array<NormalizedUsageEvent & { estimatedCost: number }>) {
  return events.reduce(
    (summary, event) => ({
      inputTokens: summary.inputTokens + event.inputTokens,
      cachedInputTokens: summary.cachedInputTokens + event.cachedInputTokens,
      outputTokens: summary.outputTokens + event.outputTokens,
      reasoningTokens: summary.reasoningTokens + event.reasoningOutputTokens,
      totalTokens: summary.totalTokens + event.totalTokens,
      estimatedCost: summary.estimatedCost + event.estimatedCost,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    },
  );
}

function getEarliestCodexEventDate(scanned: ScannedSessionResult[]): Date | null {
  const earliestKey = scanned
    .flatMap((entry) => entry.events)
    .map((event) => event.localDateKey)
    .sort((left, right) => left.localeCompare(right))[0];

  return earliestKey ? localDateKeyToLocalDate(earliestKey) : null;
}

export function resetCodexLocalCostCacheForTests(): void {
  codexScanCache = null;
}

async function loadCodexScanCache(forceRefresh: boolean): Promise<{
  codexHome: string;
  discoveryWarnings: string[];
  scanned: ScannedSessionResult[];
}> {
  const timezone = resolveDefaultTimezone();
  const codexHome = resolveCodexHome(process.env);

  if (
    !forceRefresh &&
    codexScanCache &&
    codexScanCache.codexHome === codexHome &&
    codexScanCache.timezone === timezone
  ) {
    return {
      codexHome,
      discoveryWarnings: codexScanCache.discoveryWarnings,
      scanned: codexScanCache.scanned,
    };
  }

  const discovery = await discoverRolloutFiles(codexHome);
  const scanned: ScannedSessionResult[] = [];

  for (const filePath of discovery.files) {
    scanned.push(
      await scanSessionFile(filePath, normalizePathSegments(path.relative(path.join(codexHome, "sessions"), filePath)), {
        timezone,
        fallbackModel: DEFAULT_FALLBACK_MODEL,
      }),
    );
  }

  codexScanCache = {
    codexHome,
    timezone,
    discoveryWarnings: discovery.warnings,
    scanned,
  };

  return {
    codexHome,
    discoveryWarnings: discovery.warnings,
    scanned,
  };
}

export async function collectCodexLocalCost(
  now: Date,
  previousSnapshot: ProviderSnapshot | undefined,
  selectedUsageRange: UsageRangePresetId,
  forceRefresh: boolean,
): Promise<CodexLocalCostSnapshot> {
  const fallbackUsageWindow = createUsageDateWindow(now, selectedUsageRange).usageWindow;
  const { discoveryWarnings, scanned } = await loadCodexScanCache(forceRefresh);

  if (scanned.length === 0) {
    return buildEmptyCodexCostSnapshot({
      warnings: mapCodexWarnings(discoveryWarnings),
      detailMessage: "No Codex session data was found under the local Codex home.",
      statusMessage: "Local Codex session data is unavailable.",
      costLastRefreshedAt: previousSnapshot?.costLastRefreshedAt ?? null,
      usageWindow: fallbackUsageWindow,
    });
  }

  const window = createUsageDateWindow(now, selectedUsageRange, {
    earliestAvailableAt: selectedUsageRange === "all" ? getEarliestCodexEventDate(scanned) : undefined,
  });
  const sessionsInRange = scanned.filter((entry) =>
    hasEventInRange(entry.events, window.codexSince, window.codexUntil),
  );
  const recentEvents = scanned
    .flatMap((entry) => entry.events)
    .filter((event) => event.localDateKey >= window.codexSince && event.localDateKey <= window.codexUntil)
    .map((event) => {
      const estimate = estimateCostForEvent(event);
      return { ...event, estimatedCost: estimate.estimatedCost, warnings: estimate.warnings };
    });

  if (recentEvents.length === 0) {
    const warnings = mapCodexWarnings(
      new Set([
        ...discoveryWarnings,
        ...scanned.flatMap((entry) => entry.session.warnings),
      ]),
    );

    return buildEmptyCodexCostSnapshot({
      warnings,
      detailMessage: `No measurable Codex activity was found for ${window.usageWindow.label.toLowerCase()}.`,
      hasWarnings: warnings.length > 0,
      statusMessage: warnings.length > 0 ? "Codex local cost data is incomplete." : "No recent Codex cost data found.",
      costLastRefreshedAt: previousSnapshot?.costLastRefreshedAt ?? now.toISOString(),
      usageWindow: window.usageWindow,
    });
  }

  const totals = summarizeEvents(recentEvents);
  const modelSummaries = aggregateByKey(
    recentEvents.map((event) => ({
      estimatedCost: event.estimatedCost,
      totalTokens: event.totalTokens,
      model: event.model,
    })),
    (item) => item.model,
  );
  const sourceSummaries = aggregateByKey(
    recentEvents.map((event) => ({
      estimatedCost: event.estimatedCost,
      totalTokens: event.totalTokens,
      source: event.source,
    })),
    (item) => item.source,
  );
  const warnings = mapCodexWarnings(
    new Set([
      ...discoveryWarnings,
      ...scanned.flatMap((entry) => entry.session.warnings),
      ...recentEvents.flatMap((event) => event.warnings),
    ]),
  );

  return {
    usageWindow: window.usageWindow,
    inputTokens: totals.inputTokens,
    cacheWriteTokens: 0,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    estimatedCost: totals.estimatedCost,
    topLabel: modelSummaries[0]?.model ?? sourceSummaries[0]?.source ?? null,
    topLabelType: modelSummaries[0] ? "model" : "source",
    activityCount: sessionsInRange.length,
    warnings,
    detailMessage: null,
    provenance: getCodexLocalProvenance(),
    costStatus: "available",
    costStatusMessage: null,
    costLastRefreshedAt: now.toISOString(),
    hasData: true,
  };
}
