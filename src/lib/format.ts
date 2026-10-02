/** Display formatting shared by the dashboard pages. */

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "–";
  return `${Math.round(ratio * 100)}%`;
}

export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return "–";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "–";
  const digits = Number.isInteger(value) ? 0 : 2;
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    } catch {
      // Unknown currency code: fall through to a plain number.
    }
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "Austin, US" style codes become "Austin, United States". */
export function formatLocation(city: string | null, country: string | null): string | null {
  if (!country) return null;
  let name = country;
  try {
    name = regionNames.of(country.toUpperCase()) ?? country;
  } catch {
    // Not a region code; show it as it is.
  }
  return city ? `${city}, ${name}` : name;
}

/**
 * Words for a model confidence score. The dashboard shows these beside every
 * inferred value so an inference is never presented as a measured fact.
 */
export function confidenceLabel(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.75) return "High";
  if (confidence >= 0.45) return "Medium";
  return "Low";
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
