/** Top-level paths the app itself uses, which a campaign link must not take. */
export const RESERVED_SLUGS = new Set([
  "api",
  "dashboard",
  "login",
  "signup",
  "logout",
  "privacy",
  "terms",
  "about",
  "admin",
  "app",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 48;

/** Turns free text into a URL-safe slug, e.g. "Air Max — Feedback!" → "air-max-feedback". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug)
  );
}
