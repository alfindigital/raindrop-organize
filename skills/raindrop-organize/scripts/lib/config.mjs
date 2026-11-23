// Your taxonomy rules live in a small JSON file, so the tool and the agent follow the same rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  tags: null,            // allowed tag vocabulary; null = any tag is fine
  priceTags: ['free', 'freemium', 'paid'], // at most one of these per bookmark
  maxTags: 3,            // null = no limit
  rootMustBeEmpty: true, // a root folder that has subfolders should hold no bookmarks itself
  skipCollections: [],   // collection ids the tool never routes into or audits (e.g. an auto-filled inbox)
  rules: [],             // plain-language routing rules shown to the agent by `context`
  examplesPerFolder: 6,  // recent titles shown per folder by `context`
  blockHosts: [],        // hosts of ISP / national filter block pages; links redirected there are "blocked", not dead
});

export function configPath(explicit, env = process.env) {
  if (explicit) return explicit;
  if (env.RAINDROP_ORGANIZE_CONFIG) return env.RAINDROP_ORGANIZE_CONFIG;
  const local = path.resolve('raindrop-organize.json');
  if (fs.existsSync(local)) return local;
  const home = path.join(os.homedir(), '.config', 'raindrop-organize.json');
  return fs.existsSync(home) ? home : null;
}

export function loadConfig(explicit, env = process.env) {
  const file = configPath(explicit, env);
  if (!file) return { ...DEFAULTS, file: null };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read config ${file}: ${e.message}`); }
  return normalize(raw, file);
}

export function normalize(raw, file = null) {
  const c = { ...DEFAULTS, ...raw, file };
  if (c.tags !== null) {
    if (!Array.isArray(c.tags)) throw new Error('config.tags must be a list of tag names or null');
    c.tags = c.tags.map((t) => String(t).toLowerCase());
  }
  c.priceTags = (c.priceTags || []).map((t) => String(t).toLowerCase());
  c.skipCollections = (c.skipCollections || []).map(Number);
  if (c.maxTags !== null && !(Number.isInteger(c.maxTags) && c.maxTags > 0)) throw new Error('config.maxTags must be a positive integer or null');
  return c;
}
