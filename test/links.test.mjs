import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, probe, probeAll, isUploadedFile } from '../skills/raindrop-organize/scripts/lib/links.mjs';

test('files uploaded to Raindrop are not link-checked', () => {
  assert.equal(isUploadedFile('https://api.raindrop.io/v2/raindrop/1/file?type=image/jpeg'), true);
  assert.equal(isUploadedFile('https://up.raindrop.io/x.pdf'), true);
  assert.equal(isUploadedFile('https://raindrop.io.evil.com/x'), false);
  assert.equal(isUploadedFile('https://github.com/x'), false);
});

const v = (x) => classify({ url: 'https://site.com/p', finalUrl: 'https://site.com/p', ...x }).verdict;

test('only strong evidence counts as dead', () => {
  assert.equal(v({ status: 200 }), 'alive');
  assert.equal(v({ status: 404 }), 'dead?');
  assert.equal(v({ status: 410 }), 'dead?');
  assert.equal(v({ error: Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }) }), 'dead?');
  assert.equal(v({ status: 200, finalUrl: 'https://www.hugedomains.com/domain_profile.cfm?d=site.com' }), 'dead?');
  assert.equal(v({ status: 200, body: '<h1>This domain is for sale</h1>' }), 'dead?');
});

test('walls, blocks, outages and renames are NOT dead', () => {
  for (const status of [401, 403, 429, 999, 400]) assert.equal(v({ status }), 'walled', String(status));
  assert.equal(v({ status: 503, body: '<title>Just a moment...</title>' }), 'walled');
  assert.equal(v({ status: 502 }), 'down');
  assert.equal(v({ status: 521 }), 'down');
  assert.equal(v({ error: Object.assign(new Error('t'), { name: 'TimeoutError' }) }), 'down');
  assert.equal(v({ error: Object.assign(new Error('r'), { cause: { code: 'ECONNRESET' } }) }), 'down');
  assert.equal(classify({ url: 'https://exchange.com', finalUrl: 'https://internet-positif.info/?u=x', status: 200, blockHosts: ['internet-positif.info'] }).verdict, 'blocked');
  assert.equal(v({ status: 200, finalUrl: 'https://newname.so/p' }), 'moved');
  assert.equal(v({ status: 200, finalUrl: 'https://www.site.com/p' }), 'alive');
  assert.equal(v({ status: 200, body: 'we use captcha on our signup form' }), 'alive');
});

test('probe never throws and probeAll keeps order', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('nxdomain')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    return { status: url.includes('gone') ? 404 : 200, url, text: async () => 'ok' };
  };
  assert.equal((await probe('https://nxdomain.example', { fetchImpl })).verdict, 'dead?');
  const r = await probeAll([{ id: 1, link: 'https://a.com' }, { id: 2, link: 'https://a.com/gone' }, { id: 3, link: 'https://nxdomain.example' }], { fetchImpl }, { concurrency: 2 });
  assert.deepEqual(r.map((x) => [x.id, x.verdict]), [[1, 'alive'], [2, 'dead?'], [3, 'dead?']]);
});
