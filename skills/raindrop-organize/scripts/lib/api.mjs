// Minimal Raindrop.io REST client (https://developer.raindrop.io). Zero dependencies; `fetch` is injectable for tests.

export const UNSORTED = -1;
export const TRASH = -99;
const BASE = 'https://api.raindrop.io/rest/v1';
const PER_PAGE = 50; // API maximum

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RaindropApi {
  constructor(token, { fetchImpl = globalThis.fetch, base = BASE, retries = 4, wait = sleep } = {}) {
    if (!token) throw new Error('RAINDROP_TOKEN is not set. Create a test token at https://app.raindrop.io/settings/integrations');
    this.token = token;
    this.fetch = fetchImpl;
    this.base = base;
    this.retries = retries;
    this.wait = wait;
  }

  async request(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // 429 = rate limit (120 requests/minute); 5xx = transient. Back off and retry.
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const after = Number(res.headers?.get?.('retry-after'));
        await this.wait(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new Error('Raindrop rejected the token (HTTP 401). Check RAINDROP_TOKEN.');
      const text = await res.text();
      if (!res.ok) throw new Error(`Raindrop ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      const json = text ? JSON.parse(text) : {};
      if (json.result === false) throw new Error(`Raindrop ${method} ${path} failed: ${json.errorMessage || json.error || 'result=false'}`);
      return json;
    }
  }

  async collections() {
    const [roots, children] = await Promise.all([this.request('/collections'), this.request('/collections/childrens')]);
    return { roots: roots.items || [], children: children.items || [] };
  }

  async tags() {
    return (await this.request('/tags')).items || [];
  }

  /** Every bookmark in a collection (0 = whole library except Trash, -1 = Unsorted), all pages. */
  async bookmarks(collectionId = 0) {
    const out = [];
    for (let page = 0; ; page++) {
      const r = await this.request(`/raindrops/${collectionId}?page=${page}&perpage=${PER_PAGE}&sort=-created`);
      const items = r.items || [];
      out.push(...items);
      if (items.length < PER_PAGE) break;
    }
    return out;
  }

  async bookmark(id) {
    return (await this.request(`/raindrop/${id}`)).item;
  }

  /** PUT only the fields that change. `tags` is the full new list (REST replaces it). */
  async update(id, fields) {
    return (await this.request(`/raindrop/${id}`, { method: 'PUT', body: fields })).item;
  }
}

export const collectionOf = (b) => b?.collection?.$id ?? b?.collectionId;
