import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const MEMBERSHIP_TYPE_KEY = "cursorAuth/stripeMembershipType";
const SUBSCRIPTION_STATUS_KEY = "cursorAuth/stripeSubscriptionStatus";

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
      throw new Error(`Cursor auth is not supported on platform "${platform}".`);
  }
}

function readSqliteValue(dbPath: string, key: string): string | null {
  if (!existsSync(dbPath)) {
    return null;
  }

  const database = new DatabaseSync(dbPath, { readOnly: true });
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

function isTokenUsable(accessToken: string, nowMs = Date.now()): boolean {
  const expiresAt = getTokenExpiration(accessToken);
  if (expiresAt === null) {
    return false;
  }

  return expiresAt > nowMs;
}

export function getCursorAccessTokenReadOnly(): string | null {
  return getCursorAuthStateReadOnly().accessToken;
}

export interface CursorAuthState {
  accessToken: string | null;
  subject: string | null;
  membershipType: string | null;
  subscriptionStatus: string | null;
}

export function getCursorAuthStateReadOnly(): CursorAuthState {
  const sqliteDbPath = resolveCursorStateDbPath();
  const accessToken = readSqliteValue(sqliteDbPath, ACCESS_TOKEN_KEY);
  const membershipType = readSqliteValue(sqliteDbPath, MEMBERSHIP_TYPE_KEY);
  const subscriptionStatus = readSqliteValue(sqliteDbPath, SUBSCRIPTION_STATUS_KEY);
  const usableAccessToken = accessToken && isTokenUsable(accessToken) ? accessToken : null;
  const payload = usableAccessToken ? decodeJwtPayload(usableAccessToken) : null;

  return {
    accessToken: usableAccessToken,
    subject: typeof payload?.sub === "string" ? payload.sub : null,
    membershipType,
    subscriptionStatus,
  };
}
