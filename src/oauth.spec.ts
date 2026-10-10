import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TokenIntrospector } from './oauth.js';

const TOKEN = 'vln_oat_unit_access_token';
const SECRET = 'unit-introspection-secret';
const BASE = 'https://api.vulnify.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TokenIntrospector', () => {
  it('sends the token as a form body and the secret as a bearer', async () => {
    let calls = 0;
    const introspector = new TokenIntrospector({
      baseUrl: BASE,
      secret: SECRET,
      fetch: async (input, init) => {
        calls += 1;
        assert.equal(String(input), `${BASE}/oauth/introspect`);
        assert.equal(init?.method, 'POST');
        assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${SECRET}`);
        assert.equal(String(init?.body), `token=${TOKEN}`);
        return json({ active: true, scope: 'policies:read decisions:read', exp: 2_000 });
      },
      now: () => 1_000_000,
    });

    const first = await introspector.introspect(TOKEN);
    const second = await introspector.introspect(TOKEN);
    assert.deepEqual(first, { ok: true, scopes: ['policies:read', 'decisions:read'] });
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
  });

  it('does not cache an inactive token or a token for another resource', async () => {
    let calls = 0;
    const introspector = new TokenIntrospector({
      baseUrl: BASE,
      secret: SECRET,
      now: () => 1_000_000,
      fetch: async () => {
        calls += 1;
        if (calls === 1) return json({ active: false });
        return json({ active: true, scope: 'policies:read', aud: 'https://example.invalid/mcp', exp: 2_000 });
      },
    });
    assert.deepEqual(await introspector.introspect(TOKEN), { ok: false, reason: 'inactive' });
    assert.deepEqual(await introspector.introspect(TOKEN), { ok: false, reason: 'inactive' });
    assert.equal(calls, 2);
  });

  it('treats introspection failures as unavailable and does not call the API without a secret', async () => {
    let calls = 0;
    const failing = new TokenIntrospector({
      baseUrl: BASE,
      secret: SECRET,
      fetch: async () => {
        calls += 1;
        return json({ error: 'invalid_client' }, 401);
      },
    });
    assert.deepEqual(await failing.introspect(TOKEN), { ok: false, reason: 'unavailable' });
    assert.equal(calls, 1);

    const unconfigured = new TokenIntrospector({
      baseUrl: BASE,
      fetch: async () => {
        calls += 1;
        return json({ active: true });
      },
    });
    assert.deepEqual(await unconfigured.introspect(TOKEN), { ok: false, reason: 'unconfigured' });
    assert.equal(calls, 1);
  });
});
