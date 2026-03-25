import type { ProviderSnapshot, SectionAvailability } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";
import {
  buildCursorSessionCookie,
  getCursorAuthStateReadOnly,
} from "./cursor-auth.js";

interface UsageRow {
  timestamp: string;
  date: string;
  kind: string;
  model: string;
  provider: string | null;
  inputCacheWrite: number;
  inputNoCacheWrite: number;
  cacheRead: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  csvCost: string;
}

interface Totals {
  inputTokens: number;
  cacheCreationTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface CursorCostSnapshot {
  inputTokens: number;
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

const CURSOR_COST_PROVENANCE = ["Cursor usage export"] as const;

function buildEmptyCursorCostSnapshot(
  status: SectionAvailability,
  statusMessage: string,
  detailMessage: string,
  costLastRefreshedAt: string | null,
): CursorCostSnapshot {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "provider",
    activityCount: 0,
    warnings: [],
    detailMessage,
    provenance: [...CURSOR_COST_PROVENANCE],
    costStatus: status,
    costStatusMessage: statusMessage,
    costLastRefreshedAt,
    hasData: false,
  };
}

function buildStaleCursorCostSnapshot(previousSnapshot: ProviderSnapshot): CursorCostSnapshot {
  return {
    inputTokens: previousSnapshot.inputTokens,
    cachedInputTokens: previousSnapshot.cachedInputTokens,
    outputTokens: previousSnapshot.outputTokens,
    reasoningTokens: previousSnapshot.reasoningTokens,
    totalTokens: previousSnapshot.totalTokens,
    estimatedCost: previousSnapshot.estimatedCost,
    topLabel: previousSnapshot.topLabel,
    topLabelType: previousSnapshot.topLabelType,
    activityCount: previousSnapshot.activityCount,
    warnings: ["Cursor usage export refresh failed. Showing last known cost data."],
    detailMessage: previousSnapshot.detailMessage,
    provenance: [...CURSOR_COST_PROVENANCE],
    costStatus: "stale",
    costStatusMessage: "Cursor cost data could not be refreshed. Showing last known values.",
    costLastRefreshedAt: previousSnapshot.costLastRefreshedAt,
    hasData: true,
  };
}

function parseIntValue(value: string): number {
  const normalized = value.trim();
  if (normalized === "") {
    return 0;
  }

  return Number.parseInt(normalized.replace(/,/g, ""), 10);
}

function parseMoneyValue(value: string): number {
  const normalized = value.replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toLocalDateString(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp "${value}".`);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rowInRange(date: string, range: { since: string; until: string }): boolean {
  const normalized = date.replace(/-/g, "");
  return normalized >= range.since && normalized <= range.until;
}

function parseCsv(csvText: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          currentValue += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentValue += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return [];
  }

  return dataRows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const record: Record<string, string> = {};
      headerRow.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function detectProvider(model: string): string | null {
  const normalized = model.toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "Anthropic";
  }
  if (
    normalized.includes("gpt") ||
    normalized.includes("openai") ||
    normalized.includes("codex") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  ) {
    return "OpenAI";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "Google";
  }
  return null;
}

function hasUsage(row: UsageRow): boolean {
  return (
    row.inputNoCacheWrite !== 0 ||
    row.outputTokens !== 0 ||
    row.inputCacheWrite !== 0 ||
    row.cacheRead !== 0 ||
    row.totalTokens !== 0 ||
    row.estimatedCost !== 0
  );
}

function calculateTotals(rows: UsageRow[]): Totals {
  return rows.reduce<Totals>(
    (totals, row) => ({
      inputTokens: totals.inputTokens + row.inputNoCacheWrite,
      cacheCreationTokens: totals.cacheCreationTokens + row.inputCacheWrite,
      cachedInputTokens: totals.cachedInputTokens + row.cacheRead,
      outputTokens: totals.outputTokens + row.outputTokens,
      totalTokens: totals.totalTokens + row.totalTokens,
      totalCost: totals.totalCost + row.estimatedCost,
    }),
    {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  );
}

function summarizeRows(rows: UsageRow[]): {
  totals: Totals;
  activityCount: number;
  topProvider: string | null;
  topModel: string | null;
} {
  const totals = calculateTotals(rows);
  const activityCount = new Set(rows.map((row) => row.date)).size;
  const byModel = new Map<string, { estimatedCost: number; totalTokens: number }>();
  const byProvider = new Map<string, { estimatedCost: number; totalTokens: number }>();

  for (const row of rows) {
    const modelTotals = byModel.get(row.model) ?? { estimatedCost: 0, totalTokens: 0 };
    modelTotals.estimatedCost += row.estimatedCost;
    modelTotals.totalTokens += row.totalTokens;
    byModel.set(row.model, modelTotals);

    const providerKey = row.provider ?? "unknown";
    const providerTotals = byProvider.get(providerKey) ?? { estimatedCost: 0, totalTokens: 0 };
    providerTotals.estimatedCost += row.estimatedCost;
    providerTotals.totalTokens += row.totalTokens;
    byProvider.set(providerKey, providerTotals);
  }

  const topModel = Array.from(byModel.entries()).sort((left, right) => {
    const costDiff = right[1].estimatedCost - left[1].estimatedCost;
    if (costDiff !== 0) {
      return costDiff;
    }
    return right[1].totalTokens - left[1].totalTokens;
  })[0]?.[0] ?? null;

  const topProvider = Array.from(byProvider.entries()).sort((left, right) => {
    const costDiff = right[1].estimatedCost - left[1].estimatedCost;
    if (costDiff !== 0) {
      return costDiff;
    }
    return right[1].totalTokens - left[1].totalTokens;
  })[0]?.[0] ?? null;

  return { totals, activityCount, topProvider, topModel };
}

async function downloadUsageCsv(range: { startDate: number; endDate: number }): Promise<string> {
  const authState = getCursorAuthStateReadOnly();
  if (!authState.accessToken || !authState.subject) {
    throw new Error("Cursor access token is unavailable or expired.");
  }

  const url = new URL("https://cursor.com/api/dashboard/export-usage-events-csv");
  url.search = new URLSearchParams({
    startDate: String(range.startDate),
    endDate: String(range.endDate),
    strategy: "tokens",
  }).toString();

  const response = await fetch(url, {
    headers: {
      Cookie: buildCursorSessionCookie(authState.accessToken, authState.subject),
      Accept: "text/csv",
    },
  });

  if (!response.ok) {
    throw new Error(`Cursor export request failed with HTTP ${response.status}.`);
  }

  return response.text();
}

function parseUsageCsv(csvText: string, range: { since: string; until: string }): UsageRow[] {
  const parsed = parseCsv(csvText);

  return parsed
    .map((record) => {
      const timestamp = record["Date"] ?? "";
      const date = toLocalDateString(timestamp);
      const model = (record["Model"] ?? "").trim();
      const inputCacheWrite = parseIntValue(record["Input (w/ Cache Write)"] ?? "");
      const inputNoCacheWrite = parseIntValue(record["Input (w/o Cache Write)"] ?? "");
      const cacheRead = parseIntValue(record["Cache Read"] ?? "");
      const outputTokens = parseIntValue(record["Output Tokens"] ?? "");
      const totalTokens = parseIntValue(record["Total Tokens"] ?? "");

      return {
        timestamp,
        date,
        kind: (record["Kind"] ?? "").trim(),
        model,
        provider: detectProvider(model),
        inputCacheWrite,
        inputNoCacheWrite,
        cacheRead,
        outputTokens,
        totalTokens,
        estimatedCost: parseMoneyValue(record["Cost"] ?? ""),
        csvCost: (record["Cost"] ?? "").trim(),
      };
    })
    .filter((row) => rowInRange(row.date, range));
}

export async function collectCursorCost(
  now: Date,
  previousSnapshot: ProviderSnapshot | undefined,
): Promise<CursorCostSnapshot> {
  const window = createRecentDateWindow(now);

  let csvText: string;
  try {
    const since = new Date(`${window.cursorSince.slice(0, 4)}-${window.cursorSince.slice(4, 6)}-${window.cursorSince.slice(6, 8)}T00:00:00.000`);
    const until = new Date(`${window.cursorUntil.slice(0, 4)}-${window.cursorUntil.slice(4, 6)}-${window.cursorUntil.slice(6, 8)}T23:59:59.999`);
    csvText = await downloadUsageCsv({
      startDate: since.getTime(),
      endDate: until.getTime(),
    });
  } catch (error) {
    if (previousSnapshot && previousSnapshot.costStatus === "available") {
      return buildStaleCursorCostSnapshot(previousSnapshot);
    }

    return buildEmptyCursorCostSnapshot(
      "unsupported",
      "Cursor token-cost export is unavailable.",
      error instanceof Error ? error.message : "Cursor cost data is unavailable.",
      previousSnapshot?.costLastRefreshedAt ?? null,
    );
  }

  const usageRows = parseUsageCsv(csvText, {
    since: window.cursorSince,
    until: window.cursorUntil,
  }).filter(hasUsage);

  if (usageRows.length === 0) {
    return buildEmptyCursorCostSnapshot(
      "unsupported",
      "No recent Cursor token-cost data found.",
      `No Cursor usage rows were found for ${window.usageWindow.label.toLowerCase()}.`,
      now.toISOString(),
    );
  }

  const { totals, activityCount, topProvider, topModel } = summarizeRows(usageRows);
  const providerLabel = topProvider && topProvider !== "unknown" ? topProvider : null;
  const warnings = usageRows.some((row) => row.csvCost.trim().length === 0)
    ? ["Cursor export included rows with missing cost values."]
    : [];

  return {
    inputTokens: totals.inputTokens + totals.cacheCreationTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: 0,
    totalTokens: totals.totalTokens,
    estimatedCost: totals.totalCost,
    topLabel: providerLabel ?? topModel,
    topLabelType: providerLabel ? "provider" : "model",
    activityCount,
    warnings,
    detailMessage: null,
    provenance: [...CURSOR_COST_PROVENANCE],
    costStatus: "available",
    costStatusMessage: null,
    costLastRefreshedAt: now.toISOString(),
    hasData: true,
  };
}
