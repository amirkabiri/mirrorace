export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";

export const DEFAULT_MIRRORS = [
  "https://package-mirror.liara.ir/repository/npm/pnpm",
  "https://mirror-npm.runflare.com",
  "https://archive.ito.gov.ir/npm/",
  "https://mirror2.chabokan.net/npm/",
];

export const DEFAULT_MIRROR_IPS = {
  "https://package-mirror.liara.ir/repository/npm/pnpm": "185.208.181.186",
  "https://mirror-npm.runflare.com": "185.126.10.222",
  "https://archive.ito.gov.ir/npm": "2.187.253.113",
  "https://mirror2.chabokan.net/npm": "185.173.129.51",
};

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
