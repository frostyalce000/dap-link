import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/** Best-effort client IP from the proxy headers set by the hosting platform. */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}

/**
 * The raw IP is never stored. A salted hash is enough for rate limiting and
 * spotting repeat visits, and cannot be turned back into an address.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.ipHashSalt}:${networkOf(ip)}`).digest("hex").slice(0, 32);
}

/**
 * The unit rate limits apply to. An IPv6 host usually controls a whole /64
 * block, so limiting single addresses would be trivial to dodge; the first
 * four groups are used instead.
 */
function networkOf(ip: string): string {
  const address = ip.replace(/^::ffff:/i, "");
  if (!address.includes(":")) return address;
  const [head = "", tail = ""] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Approximate location derived from the IP by the edge network (Vercel sets
 * these headers). City-level at most; no browser geolocation is requested.
 */
export function getApproximateGeo(headers: Headers) {
  return {
    country: decodeHeader(headers.get("x-vercel-ip-country")),
    region: decodeHeader(headers.get("x-vercel-ip-country-region")),
    city: decodeHeader(headers.get("x-vercel-ip-city")),
  };
}

export function getDeviceType(userAgent: string | null): "mobile" | "tablet" | "desktop" | null {
  if (!userAgent) return null;
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** The public origin of this deployment, taken from the request itself. */
export function getAppOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return env.appUrl;
  const protocol = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
