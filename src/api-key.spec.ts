import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { ApiKeyChecker, apiKeyCacheKey } from './api-key.js';

const KEY = 'vln_test_unit_api_key';
const OTHER = 'vln_live_unit_other_key';
const BASE = 'https://api.vulnify.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('apiKeyCacheKey', () => {
  it('is the SHA-256 of the key and does not contain the key', () => {
    const hash = createHash('sha256').update(KEY).digest('hex');
    assert.equal(apiKeyCacheKey(KEY), hash);
    assert.equal(apiKeyCacheKey(KEY).includes(KEY), false);
    assert.notEqual(apiKeyCacheKey(KEY), apiKeyCacheKey(OTHER));
  });
});

describe('ApiKeyChecker', () => {
  it('checks GET /v1/policies and reuses a success for at most 60s', async () => {
    let now = 1_700_000_000_000;
    let calls = 0;
    const checker = new ApiKeyChecker({
      baseUrl: BASE,
      now: () => now,
      fetch: async (input, init) => {
        calls += 1;
        assert.equal(String(input), `${BASE}/v1/policies`);
        assert.equal(init?.method, 'GET');
        const authorization = new Headers(init?.headers).get('authorization');
        assert.ok(authorization === `Bearer ${KEY}` || authorization === `Bearer ${OTHER}`);
        return json({ apiVersion: 'vulnify.io/v1', policies: [] });
      },
    });

    assert.deepEqual(await checker.check(KEY), { ok: true });
    now += 59_000;
    assert.deepEqual(await checker.check(KEY), { ok: true });
    assert.equal(calls, 1);
    now += 1_000;
    assert.deepEqual(await checker.check(KEY), { ok: true });
    assert.equal(calls, 2);
    assert.deepEqual(await checker.check(OTHER), { ok: true });
    assert.equal(calls, 3);
  });

  it('does not cache a rejected key', async () => {
    let calls = 0;
    const checker = new ApiKeyChecker({
      baseUrl: BASE,
      fetch: async () => {
        calls += 1;
        return json({ message: 'Invalid API key' }, 401);
      },
    });
    assert.deepEqual(await checker.check(KEY), { ok: false, reason: 'invalid' });
    assert.deepEqual(await checker.check(KEY), { ok: false, reason: 'invalid' });
    assert.equal(calls, 2);
  });

  it('accepts an allowlist refusal as a recognized key and does not cache an outage', async () => {
    let calls = 0;
    const allowlisted = new ApiKeyChecker({
      baseUrl: `${BASE}/`,
      fetch: async (input) => {
        calls += 1;
        assert.equal(String(input), `${BASE}/v1/policies`);
        return json({ message: 'Caller IP is not allowlisted' }, 403);
      },
    });
    assert.deepEqual(await allowlisted.check(KEY), { ok: true });
    assert.deepEqual(await allowlisted.check(KEY), { ok: true });
    assert.equal(calls, 1);

    const down = new ApiKeyChecker({
      baseUrl: BASE,
      fetch: async () => {
        calls += 1;
        return json({ message: 'unavailable' }, 503);
      },
    });
    assert.deepEqual(await down.check(KEY), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await down.check(KEY), { ok: false, reason: 'unavailable' });
    assert.equal(calls, 3);

    const offline = new ApiKeyChecker({
      baseUrl: BASE,
      fetch: async () => {
        calls += 1;
        throw new Error('network down');
      },
    });
    assert.deepEqual(await offline.check(KEY), { ok: false, reason: 'unavailable' });
    assert.equal(calls, 4);
  });
});
