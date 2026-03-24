import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderContext, ProviderSnapshot, UsageProvider } from "../../domain/dashboard.js";
import { createRecentDateWindow } from "../shared/date-window.js";

interface CursorAuthState {
  accessToken: string | null;
  refreshToken: string | null;
}

interface CursorCsvRow {
  Date: string;
  Kind: string;
  Model: string;
  "Max Mode": string;
  "Input (w/ Cache Write)": string;
  "Input (w/o Cache Write)": string;
  "Cache Read": string;
  "Output Tokens": string;
  "Total Tokens": string;
  Cost: string;
}

interface UsageRow {
  timestamp: string;
  date: string;
  kind: string;
  model: string;
  provider: string | null;
  maxMode: boolean;
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

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const REFRESH_TOKEN_KEY = "cursorAuth/refreshToken";
const REFRESH_URL = "https://api2.cursor.sh/oauth/token";
const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const LOGIN_HINT = "Sign in via Cursor or re-run Cursor login.";

function createEmptyAuthState(): CursorAuthState {
  return {
    accessToken: null,
    refreshToken: null,
  };
}

function resolveCursorStateDbPath(
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
): string {
  switch (platform) {
    case "darwin":
      return path.posix.join(
        homeDir,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      );
    case "linux":
      return path.posix.join(homeDir, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
    case "win32": {
      const appData = env.APPDATA ?? path.win32.join(homeDir, "AppData", "Roaming");
      return path.win32.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
    }
    default:
      throw new Error(
        `Cursor auth is not supported on platform "${platform}". Expected one of darwin, win32, or linux.`,
      );
  }
}

function createMissingCursorStateDbError(dbPath: string): Error {
  return new Error(
    `Cursor state database not found at "${dbPath}". Make sure Cursor is installed and signed in.`,
  );
}

function createMissingCursorLoginError(dbPath: string | null): Error {
  if (dbPath === null) {
    return new Error(`Cursor login state could not be found locally. ${LOGIN_HINT}`);
  }

  return new Error(`Cursor login state could not be found locally in "${dbPath}". ${LOGIN_HINT}`);
}

function readSqliteValue(dbPath: string, key: string): string | null {
  if (!existsSync(dbPath)) {
    throw createMissingCursorStateDbError(dbPath);
  }

  const database = new DatabaseSync(dbPath);
  try {
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1")
      .get(key) as { value?: string } | undefined;
    const value = row?.value?.trim();
    return value && value.length > 0 ? value : null;
  } finally {
    database.close();
  }
}

function writeSqliteValue(dbPath: string, key: string, value: string): boolean {
  if (!existsSync(dbPath)) {
    return false;
  }

  const database = new DatabaseSync(dbPath);
  try {
    database
      .prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)")
      .run(key, value);
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

function loadCursorAuthState(): { authState: CursorAuthState; sqliteDbPath: string; error: Error | null } {
  const sqliteDbPath = resolveCursorStateDbPath();
  let error: Error | null = null;

  try {
    const accessToken = readSqliteValue(sqliteDbPath, ACCESS_TOKEN_KEY);
    const refreshToken = readSqliteValue(sqliteDbPath, REFRESH_TOKEN_KEY);
    if (accessToken || refreshToken) {
      return { authState: { accessToken, refreshToken }, sqliteDbPath, error: null };
    }
  } catch (loadError) {
    error = loadError instanceof Error ? loadError : new Error(String(loadError));
  }

  return { authState: createEmptyAuthState(), sqliteDbPath, error };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    return null;
  }

  try {
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized.padEnd(normalized.length + paddingLength, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTokenExpiration(accessToken: string): number | null {
  const payload = decodeJwtPayload(accessToken);
  const expiration = payload?.exp;
  return typeof expiration === "number" ? expiration * 1000 : null;
}

function needsRefresh(accessToken: string | null, nowMs = Date.now()): boolean {
  if (accessToken === null) {
    return true;
  }

  const expiresAt = getTokenExpiration(accessToken);
  if (expiresAt === null) {
    return true;
  }

  return expiresAt <= nowMs + REFRESH_BUFFER_MS;
}

function persistAccessToken(accessToken: string, sqliteDbPath: string | null): void {
  if (sqliteDbPath === null) {
    return;
  }

  writeSqliteValue(sqliteDbPath, ACCESS_TOKEN_KEY, accessToken);
}

async function refreshAccessToken(
  refreshToken: string | null,
  sqliteDbPath: string | null,
): Promise<string | null> {
  if (refreshToken === null) {
    return null;
  }

  const response = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (response.status === 400 || response.status === 401) {
    if (body?.shouldLogout === true) {
      throw new Error(`Session expired. ${LOGIN_HINT}`);
    }

    throw new Error(`Token refresh failed. ${LOGIN_HINT}`);
  }

  if (!response.ok) {
    return null;
  }

  if (body?.shouldLogout === true) {
    throw new Error(`Session expired. ${LOGIN_HINT}`);
  }

  const accessToken = typeof body?.access_token === "string" ? body.access_token : null;
  if (accessToken === null || accessToken.trim() === "") {
    return null;
  }

  persistAccessToken(accessToken, sqliteDbPath);
  return accessToken;
}

async function resolveCursorAccessToken(): Promise<string> {
  const { authState, sqliteDbPath, error } = loadCursorAuthState();
  let accessToken = authState.accessToken;

  if (accessToken === null && authState.refreshToken === null) {
    if (error !== null) {
      throw error;
    }

    throw createMissingCursorLoginError(sqliteDbPath);
  }

  if (needsRefresh(accessToken)) {
    try {
      const refreshed = await refreshAccessToken(authState.refreshToken, sqliteDbPath);
      if (refreshed !== null) {
        accessToken = refreshed;
      }
    } catch (refreshError) {
      if (accessToken === null) {
        throw refreshError;
      }
    }
  }

  if (accessToken === null) {
    throw new Error(`No usable Cursor access token found. ${LOGIN_HINT}`);
  }

  return accessToken;
}

function buildSessionToken(accessToken: string): { userId: string; sessionToken: string } {
  const payload = decodeJwtPayload(accessToken);
  const subject = payload?.sub;

  if (typeof subject !== "string" || subject.trim() === "") {
    throw new Error("Cursor access token is missing a JWT subject.");
  }

  const parts = subject.split("|");
  const userId = parts.length > 1 ? parts[1] : parts[0];
  if (userId === undefined || userId.trim() === "") {
    throw new Error("Cursor access token did not produce a valid user id.");
  }

  return {
    userId,
    sessionToken: `${userId}%3A%3A${accessToken}`,
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

function requireCsvField(row: Record<string, string>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cursor CSV is missing expected column "${key}".`);
  }

  return value;
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

function toEpochRange(window: ReturnType<typeof createRecentDateWindow>): { startDate: number; endDate: number } {
  const since = new Date(
    `${window.cursorSince.slice(0, 4)}-${window.cursorSince.slice(4, 6)}-${window.cursorSince.slice(6, 8)}T00:00:00.000`,
  );
  const until = new Date(
    `${window.cursorUntil.slice(0, 4)}-${window.cursorUntil.slice(4, 6)}-${window.cursorUntil.slice(6, 8)}T23:59:59.999`,
  );

  return { startDate: since.getTime(), endDate: until.getTime() };
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
  if (normalized.includes("kimi") || normalized.includes("moonshot")) {
    return "Moonshot";
  }
  if (normalized.includes("deepseek")) {
    return "DeepSeek";
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

function createEmptySnapshot(
  context: ProviderContext,
  detailMessage: string,
): ProviderSnapshot {
  const window = createRecentDateWindow(context.now);

  return {
    id: "cursor",
    displayName: "Cursor",
    status: "empty",
    usageWindow: window.usageWindow,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    topLabel: null,
    topLabelType: "provider",
    activityCount: 0,
    activityLabel: "Active days",
    warnings: [],
    lastRefreshedAt: context.now.toISOString(),
    staleSince: null,
    provenance: ["Cursor desktop auth", "Cursor usage export"],
    detailMessage,
  };
}

async function downloadUsageCsv(range: { startDate: number; endDate: number }): Promise<string> {
  const accessToken = await resolveCursorAccessToken();
  const { sessionToken } = buildSessionToken(accessToken);
  const url = new URL("https://cursor.com/api/dashboard/export-usage-events-csv");
  url.search = new URLSearchParams({
    startDate: String(range.startDate),
    endDate: String(range.endDate),
    strategy: "tokens",
  }).toString();

  const response = await fetch(url, {
    headers: {
      Cookie: `WorkosCursorSessionToken=${sessionToken}`,
      Accept: "text/csv",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor export request was rejected. Your local auth may have expired.");
  }

  if (!response.ok) {
    throw new Error(`Cursor export request failed with HTTP ${response.status}.`);
  }

  return response.text();
}

function parseUsageCsv(csvText: string, range: { since: string; until: string }): UsageRow[] {
  const parsed = parseCsv(csvText);

  return parsed
    .map((record) => {
      const required = [
        "Date",
        "Kind",
        "Model",
        "Max Mode",
        "Input (w/ Cache Write)",
        "Input (w/o Cache Write)",
        "Cache Read",
        "Output Tokens",
        "Total Tokens",
        "Cost",
      ] as const;

      for (const column of required) {
        if (!(column in record)) {
          throw new Error(`Cursor CSV is missing expected column "${column}".`);
        }
      }

      const timestamp = requireCsvField(record, "Date");
      const date = toLocalDateString(timestamp);
      const model = requireCsvField(record, "Model").trim();
      const maxMode = requireCsvField(record, "Max Mode").trim().toLowerCase() === "yes";
      const inputCacheWrite = parseIntValue(requireCsvField(record, "Input (w/ Cache Write)"));
      const inputNoCacheWrite = parseIntValue(requireCsvField(record, "Input (w/o Cache Write)"));
      const cacheRead = parseIntValue(requireCsvField(record, "Cache Read"));
      const outputTokens = parseIntValue(requireCsvField(record, "Output Tokens"));
      const totalTokens = parseIntValue(requireCsvField(record, "Total Tokens"));

      return {
        timestamp,
        date,
        kind: requireCsvField(record, "Kind").trim(),
        model,
        provider: detectProvider(model),
        maxMode,
        inputCacheWrite,
        inputNoCacheWrite,
        cacheRead,
        outputTokens,
        totalTokens,
        estimatedCost: parseMoneyValue(requireCsvField(record, "Cost")),
        csvCost: requireCsvField(record, "Cost").trim(),
      };
    })
    .filter((row) => rowInRange(row.date, range));
}

function createSnapshot(context: ProviderContext, rows: UsageRow[]): ProviderSnapshot {
  const { totals, activityCount, topProvider, topModel } = summarizeRows(rows);
  const warnings = rows.some((row) => row.csvCost.trim().length === 0)
    ? ["Cursor export included rows with missing cost values."]
    : [];
  const providerLabel = topProvider && topProvider !== "unknown" ? topProvider : null;

  return {
    id: "cursor",
    displayName: "Cursor",
    status: warnings.length > 0 ? "warning" : "fresh",
    usageWindow: createRecentDateWindow(context.now).usageWindow,
    inputTokens: totals.inputTokens + totals.cacheCreationTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: 0,
    totalTokens: totals.totalTokens,
    estimatedCost: totals.totalCost,
    topLabel: providerLabel ?? topModel,
    topLabelType: providerLabel ? "provider" : "model",
    activityCount,
    activityLabel: "Active days",
    warnings,
    lastRefreshedAt: context.now.toISOString(),
    staleSince: null,
    provenance: ["Cursor desktop auth", "Cursor usage export"],
    detailMessage: null,
  };
}

export const cursorProvider: UsageProvider = {
  id: "cursor",
  displayName: "Cursor",
  async getSnapshot(context: ProviderContext): Promise<ProviderSnapshot> {
    const window = createRecentDateWindow(context.now);
    const csvText = await downloadUsageCsv(toEpochRange(window));
    const parsedRows = parseUsageCsv(csvText, {
      since: window.cursorSince,
      until: window.cursorUntil,
    });
    const usageRows = parsedRows.filter(hasUsage);

    if (usageRows.length === 0) {
      return createEmptySnapshot(
        context,
        `No Cursor usage rows were found for ${window.usageWindow.label.toLowerCase()}.`,
      );
    }

    return createSnapshot(context, usageRows);
  },
};
