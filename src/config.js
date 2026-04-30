import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_MIRRORS, normalizeMirrors } from "./mirrors.js";

export async function loadConfig(configPath) {
  if (!configPath) {
    return { mirrors: normalizeMirrors(DEFAULT_MIRRORS) };
  }
  const absolute = resolve(process.cwd(), configPath);
  let raw;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (err) {
    throw new Error(`Failed to read config file at ${absolute}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${absolute}: ${err.message}`);
  }
  const list = extractMirrorsList(parsed);
  return { mirrors: normalizeMirrors([...list, ...DEFAULT_MIRRORS]) };
}

function extractMirrorsList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.mirrors)) return parsed.mirrors;
    if (Array.isArray(parsed.registries)) return parsed.registries;
  }
  return [];
}
