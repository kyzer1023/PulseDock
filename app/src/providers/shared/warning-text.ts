function humanizeWarningCode(code: string): string {
  if (code.startsWith("malformed-json-line:")) {
    return "Some local session lines could not be parsed.";
  }

  switch (code) {
    case "fallback-model":
      return "Some events required a fallback model mapping.";
    case "missing-model":
      return "Some events were missing a model identifier.";
    case "regressive-usage":
      return "Some cumulative token counters regressed and were clamped.";
    case "unknown-model-pricing":
      return "Pricing was missing for one or more models.";
    case "unmeasurable-session":
      return "Some sessions were present but did not contain measurable token data.";
    default:
      return code;
  }
}

export function summarizeUnknownModels(models: string[]): string {
  if (models.length === 0) {
    return "";
  }

  if (models.length === 1) {
    return `Pricing not found for ${models[0]}.`;
  }

  if (models.length === 2) {
    return `Pricing not found for ${models[0]} and ${models[1]}.`;
  }

  return `Pricing not found for ${models[0]}, ${models[1]}, and ${models.length - 2} more models.`;
}

export function mapCodexWarnings(warnings: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(warnings, humanizeWarningCode))).sort((left, right) =>
    left.localeCompare(right),
  );
}
