import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DashboardSnapshot, PlanMeter, ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import { mapCodexWarnings } from "../shared/warning-text.js";

interface RawLogEntry {
  timestamp?: string;
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

interface LoadedSessionFile {
  sessionId: string;
  relativePath: string;
  absolutePath: string;
  entries: RawLogEntry[];
  warnings: string[];
}

interface SessionMetadataRecord {
  sessionId: string;
  relativePath: string;
  absolutePath: string;
  source: string;
  cwd?: string;
  originator?: string;
  createdAt?: string;
  warnings: string[];
}

interface UsageSnapshot {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface NormalizedUsageEvent extends UsageSnapshot {
  sessionId: string;
  timestamp: string;
  localDateKey: string;
  localMonthKey: string;
  model: string;
  canonicalModel: string;
  source: string;
  isFallbackModel: boolean;
  warnings: string[];
}

interface ModelPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

interface PricingSource {
  getPricing(model: string): ModelPricing | null;
}

const DEFAULT_FALLBACK_MODEL = "gpt-5-codex";
const PRICING_VERSION = "openai-pricing-2026-03-23";

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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDashDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatCompactDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function resolveDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function toLocalDateKey(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function toLocalMonthKey(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(timestamp));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function normalizePathSegments(targetPath: string): string {
  return targetPath.split(path.sep).join("/");
}

function resolveCodexHome(
  explicitPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (env.CODEX_HOME) {
    return path.resolve(env.CODEX_HOME);
  }

  return path.join(os.homedir(), ".codex");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(nextPath);
      } else if (entry.isFile()) {
        results.push(nextPath);
      }
    }
  }

  await visit(root);
  return results;
}

async function discoverRolloutFiles(codexHome: string): Promise<string[]> {
  const sessionsRoot = path.join(codexHome, "sessions");
  if (!(await pathExists(sessionsRoot))) {
    return [];
  }

  const allFiles = await walkFiles(sessionsRoot);
  return allFiles
    .filter((filePath) => /rollout-.*\.jsonl$/i.test(filePath))
    .sort((left, right) => normalizePathSegments(left).localeCompare(normalizePathSegments(right)));
}

function sessionIdFromPath(codexHome: string, rolloutPath: string): string {
  const sessionsRoot = path.join(codexHome, "sessions");
  return normalizePathSegments(path.relative(sessionsRoot, rolloutPath));
}

async function loadSessionFile(
  absolutePath: string,
  sessionId: string,
): Promise<LoadedSessionFile> {
  const warnings: string[] = [];
  const rawContent = await fs.readFile(absolutePath, "utf8");
  const lines = rawContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const entries: RawLogEntry[] = [];

  for (const [index, line] of lines.entries()) {
    try {
      entries.push(JSON.parse(line) as RawLogEntry);
    } catch {
      warnings.push(`malformed-json-line:${index + 1}`);
    }
  }

  return { sessionId, relativePath: sessionId, absolutePath, entries, warnings };
}

function createUsageWindow(now: Date) {
  const since = new Date(now);
  since.setDate(now.getDate() - 6);

  return {
    label: "Last 7 days",
    since: since.toISOString(),
    until: now.toISOString(),
  };
}

function createMockPlanMeters(): PlanMeter[] {
  return [
    { id: "session", label: "Session (5h)", current: 38, limit: 100, unit: "percent", resetLabel: "Resets 2h 47m" },
    { id: "weekly", label: "Weekly", current: 54, limit: 100, unit: "percent", resetLabel: "Resets 4d 9h" },
  ];
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
    planMeters: createMockPlanMeters(),
  };
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

function resolveModel({
  directModel,
  hintModel,
  fallbackModel,
}: {
  directModel: string | undefined;
  hintModel: string | undefined;
  fallbackModel: string | undefined;
}): { model: string | undefined; isFallbackModel: boolean; warnings: string[] } {
  const resolved = [directModel, hintModel].find((value) => typeof value === "string" && value.trim().length > 0);
  if (resolved) {
    return { model: resolved.trim(), isFallbackModel: false, warnings: [] };
  }

  if (fallbackModel && fallbackModel.trim().length > 0) {
    return { model: fallbackModel.trim(), isFallbackModel: true, warnings: ["fallback-model"] };
  }

  return { model: undefined, isFallbackModel: false, warnings: ["missing-model"] };
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

function extractSessionMetadata(file: LoadedSessionFile): SessionMetadataRecord {
  let source = "unknown";
  let cwd: string | undefined;
  let originator: string | undefined;
  let createdAt = file.entries[0]?.timestamp;

  for (const entry of file.entries) {
    if (entry.type !== "session_meta") {
      continue;
    }

    const payload = isRecord(entry.payload) ? entry.payload : {};
    const meta = getNestedRecord(payload, "meta");
    source = typeof payload.source === "string" && payload.source.length > 0 ? payload.source : source;
    cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : cwd;
    originator =
      (typeof payload.originator === "string" && payload.originator.length > 0 ? payload.originator : undefined) ??
      (typeof payload.origin === "string" && payload.origin.length > 0 ? payload.origin : undefined) ??
      (typeof meta?.originator === "string" && meta.originator.length > 0 ? meta.originator : undefined) ??
      originator;
    createdAt = entry.timestamp ?? createdAt;
    break;
  }

  const record: SessionMetadataRecord = {
    sessionId: file.sessionId,
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    source,
    warnings: [...file.warnings],
  };

  if (cwd !== undefined) {
    record.cwd = cwd;
  }

  if (originator !== undefined) {
    record.originator = originator;
  }

  if (createdAt !== undefined) {
    record.createdAt = createdAt;
  }

  return record;
}

function normalizeSession(
  file: LoadedSessionFile,
  options: { timezone: string; fallbackModel: string },
): { session: SessionMetadataRecord; events: NormalizedUsageEvent[] } {
  const session = extractSessionMetadata(file);
  const events: NormalizedUsageEvent[] = [];
  let previousCumulative: UsageSnapshot | undefined;
  let currentModelHint: string | undefined;

  for (const rawEntry of file.entries) {
    const entry = isRecord(rawEntry) ? rawEntry : {};
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

    const modelResolution = resolveModel({
      directModel: usageInfo.model,
      hintModel: currentModelHint,
      fallbackModel: options.fallbackModel,
    });

    if (!modelResolution.model) {
      session.warnings.push(...modelResolution.warnings);
      continue;
    }

    const timestamp =
      typeof entry.timestamp === "string"
        ? entry.timestamp
        : session.createdAt ?? new Date().toISOString();
    const warnings = [...modelResolution.warnings];
    if (regressed) {
      warnings.push("regressive-usage");
      session.warnings.push("regressive-usage");
    }

    events.push({
      sessionId: session.sessionId,
      timestamp,
      localDateKey: toLocalDateKey(timestamp, options.timezone),
      localMonthKey: toLocalMonthKey(timestamp, options.timezone),
      model: modelResolution.model,
      canonicalModel: toCanonicalModel(modelResolution.model),
      source: session.source,
      inputTokens: snapshot.inputTokens,
      cachedInputTokens: snapshot.cachedInputTokens,
      outputTokens: snapshot.outputTokens,
      reasoningOutputTokens: snapshot.reasoningOutputTokens,
      totalTokens: snapshot.totalTokens,
      isFallbackModel: modelResolution.isFallbackModel,
      warnings,
    });
  }

  if (events.length === 0) {
    session.warnings.push("unmeasurable-session");
  }

  return { session, events };
}

function createBundledPricingSource(): PricingSource {
  return {
    getPricing(model: string): ModelPricing | null {
      return PRICING[toCanonicalModel(model)] ?? null;
    },
  };
}

function estimateCostForEvent(event: NormalizedUsageEvent): { estimatedCost: number; warnings: string[] } {
  const pricing = createBundledPricingSource().getPricing(event.canonicalModel);
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

function priceEvents(events: NormalizedUsageEvent[]): Array<NormalizedUsageEvent & { estimatedCost: number }> {
  return events.map((event) => {
    const estimate = estimateCostForEvent(event);
    return { ...event, estimatedCost: estimate.estimatedCost, warnings: estimate.warnings };
  });
}

function hasEventInRange(events: NormalizedUsageEvent[], since: string, until: string): boolean {
  return events.some((event) => event.localDateKey >= since && event.localDateKey <= until);
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

      const tokenDiff = right.totalTokens - left.totalTokens;
      if (tokenDiff !== 0) {
        return tokenDiff;
      }

      return left.key.localeCompare(right.key);
    });
}

function buildSnapshot(
  context: ProviderContext,
  events: Array<NormalizedUsageEvent & { estimatedCost: number }>,
  sessionCount: number,
  warnings: string[],
): ProviderSnapshot {
  const recentWindow = createRecentDateWindow(context.now);
  const recentEvents = events.filter(
    (event) =>
      event.localDateKey >= recentWindow.codexSince && event.localDateKey <= recentWindow.codexUntil,
  );
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
  const activityCount = new Set(recentEvents.map((event) => event.sessionId)).size || sessionCount;

  return {
    id: "codex",
    displayName: "Codex",
    status: warnings.length > 0 ? "warning" : "fresh",
    usageWindow: recentWindow.usageWindow,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    estimatedCost: totals.estimatedCost,
    topLabel: modelSummaries[0]?.model ?? sourceSummaries[0]?.source ?? null,
    topLabelType: modelSummaries[0] ? "model" : "source",
    activityCount,
    activityLabel: "Sessions",
    warnings,
    lastRefreshedAt: context.now.toISOString(),
    staleSince: null,
    provenance: ["Codex local sessions"],
    detailMessage: null,
    planMeters: createMockPlanMeters(),
  };
}

export const codexProvider: UsageProvider = {
  id: "codex",
  displayName: "Codex",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
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
    const filteredEvents = normalized.flatMap((entry) => entry.events).filter((event) =>
      event.localDateKey >= createRecentDateWindow(context.now).codexSince &&
      event.localDateKey <= createRecentDateWindow(context.now).codexUntil,
    );

    if (filteredEvents.length === 0) {
      const warnings = mapCodexWarnings(
        new Set([
          ...loadedFiles.flatMap((file) => file.warnings),
          ...normalized.flatMap((entry) => entry.session.warnings),
        ]),
      );

      return {
        ...createEmptySnapshot(
          context,
          `No measurable Codex activity was found for ${createRecentDateWindow(context.now).usageWindow.label.toLowerCase()}.`,
        ),
        warnings,
        status: warnings.length > 0 ? "warning" : "empty",
      };
    }

    const sessionsInRange = normalized
      .filter((entry) =>
        hasEventInRange(
          entry.events,
          createRecentDateWindow(context.now).codexSince,
          createRecentDateWindow(context.now).codexUntil,
        ),
      )
      .map((entry) => entry.session);
    const pricedEvents = priceEvents(filteredEvents);
    const warnings = mapCodexWarnings(
      new Set([
        ...sessionsInRange.flatMap((session) => session.warnings),
        ...loadedFiles.flatMap((file) => file.warnings),
        ...pricedEvents.flatMap((event) => event.warnings),
      ]),
    );

    return buildSnapshot(context, pricedEvents, sessionsInRange.length, warnings);
  },
};
