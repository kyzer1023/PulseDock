import type { QuotaMeter } from "../../domain/dashboard.js";

export function markMetersStale(previous: QuotaMeter[]): QuotaMeter[] {
  return previous.map((meter) => ({
    ...meter,
    availability: meter.availability === "available" ? "stale" : meter.availability,
  }));
}
