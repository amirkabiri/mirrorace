export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";

export function normalizeMirrorUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  let pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname === "") pathname = "";
  return `${url.protocol}//${url.host}${pathname}`;
}

export function normalizeMirrors(list) {
  const seen = new Set();
  const result = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const normalized = normalizeMirrorUrl(item);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
  }
  const officialNormalized = normalizeMirrorUrl(OFFICIAL_NPM_REGISTRY);
  if (!seen.has(officialNormalized)) {
    seen.add(officialNormalized);
    result.push(officialNormalized);
  }
  return result;
}
