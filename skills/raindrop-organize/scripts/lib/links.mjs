// Dead-link check that errs on the side of "alive". A link is only reported as dead when the evidence
// is strong; anything a bot wall, a login wall, a region block or a flaky server could explain is not.
// It never deletes anything: the report is for a human to decide.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PARKED = /(sedo(parking)?\.com|dan\.com|hugedomains\.com|afternic\.com|parkingcrew\.net|bodis\.com)/i;
const PARKED_TEXT = /(this domain (name )?(is|may be) for sale|buy this domain|domain is parked)/i;
const CHALLENGE_TEXT = /(just a moment\.\.\.|cf-chl-|attention required! \| cloudflare|checking your browser before accessing)/i;

/**
 * Verdicts:
 *  alive       2xx (or a redirect that lands on 2xx on the same site)
 *  moved       redirected to another site that answered 2xx; probably renamed, keep it
 *  walled      401/403/429/999, bot challenge, login wall: the page exists, we just can't see it
 *  blocked     redirected to a block page you configured (ISP / national filter); check from another network
 *  down        5xx or timeout: maybe temporary, re-check after 24 h before believing it
 *  dead?       404/410, DNS failure, or a parked/for-sale domain: strong signal, still confirm before deleting
 */
export function classify({ status, finalUrl, url, body = '', error, blockHosts = [] }) {
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const finalHost = host(finalUrl || url);
  if (error) {
    const code = String(error.code || error.cause?.code || error.name || error);
    if (/ENOTFOUND|EAI_NONAME|ERR_NAME_NOT_RESOLVED/i.test(code)) return { verdict: 'dead?', why: 'domain does not resolve (DNS)' };
    if (/abort|timeout/i.test(code)) return { verdict: 'down', why: 'timed out' };
    return { verdict: 'down', why: `network error ${code}; may be blocked on this network, try another` };
  }
  if (blockHosts.some((h) => finalHost === h || finalHost.endsWith(`.${h}`))) return { verdict: 'blocked', why: `redirected to block page ${finalHost}` };
  if (PARKED.test(finalHost) || (status < 400 && PARKED_TEXT.test(body))) return { verdict: 'dead?', why: 'domain is parked / for sale' };
  if ([401, 403, 429, 999].includes(status) || CHALLENGE_TEXT.test(body)) return { verdict: 'walled', why: `HTTP ${status}: bot or login wall, page likely exists` };
  if (status === 404 || status === 410) return { verdict: 'dead?', why: `HTTP ${status}` };
  if (status >= 500) return { verdict: 'down', why: `HTTP ${status}: server error, re-check after 24 h` };
  if (status >= 400) return { verdict: 'walled', why: `HTTP ${status}` };
  if (finalHost && host(url) && finalHost !== host(url)) return { verdict: 'moved', why: `now at ${finalHost}` };
  return { verdict: 'alive', why: `HTTP ${status}` };
}

export async function probe(url, { fetchImpl = globalThis.fetch, timeoutMs = 25000, blockHosts = [] } = {}) {
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en,*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = '';
    try { body = (await res.text()).slice(0, 20000); } catch { /* body is optional */ }
    return { url, status: res.status, finalUrl: res.url || url, ...classify({ status: res.status, finalUrl: res.url || url, url, body, blockHosts }) };
  } catch (error) {
    return { url, status: null, finalUrl: url, ...classify({ url, error, blockHosts }) };
  }
}

/** Files uploaded to Raindrop itself (screenshots, PDFs) live on raindrop.io; there is no outside link to check. */
export function isUploadedFile(link) {
  try { return /(^|\.)raindrop\.io$/i.test(new URL(link).hostname); } catch { return false; }
}

/** Probe many links with a small concurrency limit. */
export async function probeAll(items, opts = {}, { concurrency = 6, onResult = () => {} } = {}) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const r = await probe(items[i].link, opts);
      out[i] = { id: items[i].id, title: items[i].title, ...r };
      onResult(out[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export function formatLinks(results) {
  const order = ['dead?', 'down', 'blocked', 'moved', 'walled', 'alive'];
  const counts = Object.fromEntries(order.map((v) => [v, results.filter((r) => r.verdict === v).length]));
  const lines = [`Checked ${results.length} links: ${order.map((v) => `${counts[v]} ${v}`).join(', ')}.`];
  for (const v of ['dead?', 'down', 'blocked', 'moved']) {
    const list = results.filter((r) => r.verdict === v);
    if (!list.length) continue;
    lines.push('', `${v} (${list.length}):`);
    for (const r of list) lines.push(`  - ${r.id} ${r.title} <${r.url}>: ${r.why}`);
  }
  lines.push('', 'Nothing was deleted. Before removing a "dead?" link, confirm it from a second network or a day later.');
  return lines.join('\n');
}
