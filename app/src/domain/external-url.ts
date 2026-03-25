const ALLOWED_EXTERNAL_HOSTS = new Set([
  "chatgpt.com",
  "platform.openai.com",
  "status.openai.com",
  "cursor.com",
  "www.cursor.com",
  "status.cursor.com",
]);

export function assertAllowedExternalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) {
    throw new Error("Blocked external URL.");
  }

  return url.toString();
}
