// Read-only health checks for a Raindrop library. Pure functions: data in, findings out.
import { UNSORTED, collectionOf } from './api.mjs';

/** Same page, different spelling: scheme, www, trailing slash, #fragment and utm_* are ignored. */
export function normalizeUrl(link) {
  try {
    const u = new URL(String(link).trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...u.searchParams].filter(([k]) => !/^(utm_|fbclid$|gclid$|ref$|ref_src$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? `?${new URLSearchParams(params)}` : '';
    const p = u.pathname.replace(/\/+$/, '') || '';
    // "#section" is the same page, but "#/route" or "#!/route" is a different screen of a single-page app
    // (e.g. two Google Analytics properties), so those fragments are kept.
    const route = /^#!?\//.test(u.hash) ? u.hash : '';
    return `${host}${u.port ? `:${u.port}` : ''}${p}${q}${route}`;
  } catch {
    return String(link || '').trim().toLowerCase();
  }
}

export function folderIndex({ roots = [], children = [] }) {
  const byId = new Map();
  for (const r of roots) byId.set(r._id, { id: r._id, title: r.title, parent: null, count: r.count ?? 0 });
  for (const c of children) byId.set(c._id, { id: c._id, title: c.title, parent: c.parent?.$id ?? null, count: c.count ?? 0 });
  const pathOf = (id) => {
    const seen = new Set();
    const parts = [];
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parent)) { seen.add(cur.id); parts.unshift(cur.title); }
    return parts.join(' / ');
  };
  const hasChildren = new Set(children.map((c) => c.parent?.$id));
  return { byId, pathOf, hasChildren };
}

export function tagProblems(tags, config) {
  const t = (tags || []).map((x) => String(x).toLowerCase());
  const problems = [];
  if (config.tags) {
    const off = t.filter((x) => !config.tags.includes(x));
    if (off.length) problems.push(`tags outside the vocabulary: ${off.join(', ')}`);
  }
  if (config.maxTags !== null && t.length > config.maxTags) problems.push(`${t.length} tags (max ${config.maxTags})`);
  const price = t.filter((x) => config.priceTags.includes(x));
  if (price.length > 1) problems.push(`more than one price tag: ${price.join(', ')}`);
  return problems;
}

export function audit({ collections, bookmarks, config }) {
  const idx = folderIndex(collections);
  const skip = new Set(config.skipCollections);
  const live = bookmarks.filter((b) => !skip.has(collectionOf(b)));
  const label = (b) => ({ id: b._id, title: b.title || '', link: b.link || '', folder: idx.pathOf(collectionOf(b)) || String(collectionOf(b)) });

  const unsorted = live.filter((b) => collectionOf(b) === UNSORTED).map(label);
  const unknownFolder = live.filter((b) => collectionOf(b) !== UNSORTED && !idx.byId.has(collectionOf(b))).map(label);
  const inRoot = config.rootMustBeEmpty
    ? live.filter((b) => idx.hasChildren.has(collectionOf(b)) && idx.byId.get(collectionOf(b))?.parent === null).map(label)
    : [];
  const badTags = live.map((b) => ({ ...label(b), tags: b.tags || [], problems: tagProblems(b.tags, config) })).filter((x) => x.problems.length);

  const groups = new Map();
  for (const b of live) {
    const key = normalizeUrl(b.link);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), label(b)]);
  }
  const duplicates = [...groups.entries()].filter(([, v]) => v.length > 1).map(([url, items]) => ({ url, items }));

  const members = new Map();
  for (const b of bookmarks) members.set(collectionOf(b), (members.get(collectionOf(b)) || 0) + 1);
  const empty = [...idx.byId.values()].filter((f) => !idx.hasChildren.has(f.id) && !members.get(f.id) && !skip.has(f.id)).map((f) => idx.pathOf(f.id));

  const issues = unsorted.length + unknownFolder.length + inRoot.length + badTags.length + duplicates.length;
  return {
    totals: { bookmarks: bookmarks.length, folders: idx.byId.size, unsorted: unsorted.length },
    unsorted, unknownFolder, inRoot, badTags, duplicates, emptyFolders: empty,
    clean: issues === 0,
  };
}

export function formatAudit(r) {
  const lines = [`${r.totals.bookmarks} bookmarks in ${r.totals.folders} folders.`];
  const section = (title, list, fmt) => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length}):`);
    for (const x of list.slice(0, 25)) lines.push(`  - ${fmt(x)}`);
    if (list.length > 25) lines.push(`  ... ${list.length - 25} more (use --json)`);
  };
  section('Unsorted', r.unsorted, (x) => `${x.id} ${x.title} <${x.link}>`);
  section('In a root folder that has subfolders', r.inRoot, (x) => `${x.id} ${x.title} [${x.folder}]`);
  section('In a folder the API did not list', r.unknownFolder, (x) => `${x.id} ${x.title} [${x.folder}]`);
  section('Tag problems', r.badTags, (x) => `${x.id} ${x.title}: ${x.problems.join('; ')}`);
  section('Same URL saved more than once', r.duplicates, (d) => `${d.url}: ${d.items.map((i) => `${i.id} [${i.folder}]`).join(', ')}`);
  section('Empty folders (info only)', r.emptyFolders, (x) => x);
  lines.push('', r.clean ? 'CLEAN: nothing to fix.' : 'NEEDS ATTENTION: see the sections above. Nothing was changed.');
  return lines.join('\n');
}
