import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const { outputFiles } = await build({ entryPoints: ['src/updates.ts'], bundle: true, format: 'esm', write: false });
const { isNewerVersion, parseRelease, fetchLatestRelease, createUpdateChecker, CHECK_INTERVAL_MS, RETRY_INTERVAL_MS, MANUAL_INTERVAL_MS } =
  await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const release = { tag_name: 'v0.1.4', assets: [{ name: 'byrdocs-wiki-print.zip', state: 'uploaded' }] };

test('numeric versions, optional fourth segment, no prerelease or invalid tags', () => {
  assert.equal(isNewerVersion('v0.1.10', '0.1.9'), true);
  assert.equal(isNewerVersion('0.1.3.1', '0.1.3'), true);
  for (const value of ['v0.1.3', '0.1.2', '0.1.3.0', 'v0.2.0-beta', 'bad', '0.1.65536', null]) {
    assert.equal(isNewerVersion(value, '0.1.3'), false);
  }
  assert.equal(parseRelease(release).hasDownload, true);
  assert.equal(parseRelease({ tag_name: 'v0.1.4', assets: [] }).hasDownload, false);
  assert.throws(() => parseRelease({ ...release, draft: true }));
  assert.throws(() => parseRelease({ ...release, prerelease: true }));
  assert.throws(() => parseRelease({ tag_name: '<img src=x>' }));
});

function harness(initial = {}) {
  let state = initial;
  let now = 2 * CHECK_INTERVAL_MS;
  let calls = 0;
  let failure = false;
  const check = createUpdateChecker({
    read: async () => state,
    write: async next => { state = next; },
    now: () => now,
    fetchRelease: async () => { calls++; if (failure) throw Error('offline'); return release; },
  });
  return { check, get state() { return state; }, get calls() { return calls; }, advance: ms => { now += ms; }, fail: value => { failure = value; } };
}

test('startup check, concurrent tab requests, daily cache and manual throttling', async () => {
  const h = harness();
  await Promise.all([h.check(), h.check(), h.check(true)]);
  assert.equal(h.calls, 1);
  assert.equal(h.state.latestVersion, '0.1.4');
  await h.check();
  await h.check(true);
  assert.equal(h.calls, 1);
  h.advance(MANUAL_INTERVAL_MS);
  await h.check(true);
  assert.equal(h.calls, 2);
  h.advance(CHECK_INTERVAL_MS);
  await h.check();
  assert.equal(h.calls, 3);
});

test('failure retains known release, hourly retry, success clears the error', async () => {
  const h = harness();
  await h.check();
  const checkedAt = h.state.checkedAt;
  h.advance(CHECK_INTERVAL_MS);
  h.fail(true);
  await h.check();
  assert.equal(h.state.checkedAt, checkedAt);
  assert.equal(h.state.latestVersion, '0.1.4');
  assert.ok(h.state.error);
  await h.check();
  assert.equal(h.calls, 2);
  h.advance(RETRY_INTERVAL_MS);
  h.fail(false);
  await h.check();
  assert.equal(h.calls, 3);
  assert.equal(h.state.error, undefined);
});

test('persisted attempt survives worker recreation; backwards clock does not block forever', async () => {
  const h = harness();
  await h.check();
  const restarted = harness(h.state);
  await restarted.check();
  assert.equal(restarted.calls, 0);
  restarted.advance(-CHECK_INTERVAL_MS);
  await restarted.check();
  assert.equal(restarted.calls, 1);
});

test('bundled service worker registers lifecycle, alarm and asynchronous update message', async () => {
  const handlers = {};
  const store = {};
  let fetches = 0;
  let alarm;
  const event = name => ({ addListener: fn => { handlers[name] = fn; } });
  const chrome = {
    runtime: { id: 'test-extension', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    alarms: { get: async () => alarm, create: async (name, config) => { alarm = { name, ...config }; }, onAlarm: event('alarm') },
    storage: { local: { get: async () => store, set: async data => Object.assign(store, data) } },
  };
  vm.runInNewContext(readFileSync('dist/background.js', 'utf8'), {
    chrome, console, AbortSignal, fetch: async (url, options) => {
      fetches++;
      assert.equal(url, 'https://api.github.com/repos/haohaomin/byrdocs-wiki-print/releases/latest');
      assert.equal(options.credentials, 'omit');
      return { ok: true, json: async () => release };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alarm.periodInMinutes, 60);
  assert.equal(handlers.message({ type: 'bdwp-check-update' }, { id: 'other' }, () => assert.fail()), undefined);
  const response = await new Promise(resolve => {
    assert.equal(handlers.message({ type: 'bdwp-check-update' }, { id: 'test-extension' }, resolve), true);
  });
  assert.equal(response.latestVersion, '0.1.4');
  handlers.installed(); handlers.startup(); handlers.alarm({ name: alarm.name });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 1);
});


test('API quota exhaustion falls back to public stable release redirect', async () => {
  const calls = [];
  const result = await fetchLatestRelease(async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes('api.github.com')) return { ok: false, status: 403 };
    assert.equal(options.credentials, 'omit');
    return { ok: true, url: 'https://github.com/haohaomin/byrdocs-wiki-print/releases/tag/v0.1.4' };
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'HEAD');
  assert.deepEqual(parseRelease(result), { latestVersion: '0.1.4', hasDownload: false });
});

test('fallback rejects unexpected destinations and invalid versions', async () => {
  for (const destination of [
    'https://github.com/login',
    'https://example.com/haohaomin/byrdocs-wiki-print/releases/tag/v0.1.4',
    'https://github.com/haohaomin/byrdocs-wiki-print/releases/tag/v0.1.4-beta',
  ]) {
    await assert.rejects(fetchLatestRelease(async url => url.includes('api.github.com')
      ? { ok: false, status: 403 } : { ok: true, url: destination }));
  }
});
