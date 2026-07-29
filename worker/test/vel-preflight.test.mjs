import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entryPoint = fileURLToPath(new URL('../src/vel-preflight.ts', import.meta.url));
const bundle = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  buildHavenVelPreflightPrompt,
  readHavenVelPreflight,
} = await import(moduleUrl);

const validContext = {
  queried: true,
  source: 'pulsesync',
  verification: 'haven-authenticated-owner',
  latest_receipt_at: '2026-07-28T22:00:00Z',
  freshness: { state: 'fresh', age_bucket: '1_to_6h', reason: null },
  capacity: {
    state: 'limited',
    pacing: ['prefer_shorter_reply', 'one_decision_at_a_time'],
    basis_freshness: {
      spoons: { state: 'fresh' },
      daily_demands: { state: 'fresh' },
    },
  },
  privacy: { raw_values_included: false, medical_interpretation: false },
};

describe('Haven author-scoped PulseSync preflight', () => {
  it('performs zero request without a verified single-owner auth boundary', async () => {
    let calls = 0;
    const result = await readHavenVelPreflight(
      { VEL_PREFLIGHT_HAVEN_API_KEY: 'fixture' },
      false,
      async () => {
        calls += 1;
        return Response.json(validContext);
      },
    );
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  it('uses the fixed Nexus route and compacts an authorized response', async () => {
    const requests = [];
    const result = await readHavenVelPreflight(
      { VEL_PREFLIGHT_HAVEN_API_KEY: 'fixture-private-key' },
      true,
      async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({
          ...validContext,
          raw_samples: [{ heart_rate: 999 }],
          unexpected_private_value: 123,
        });
      },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://nexus-gateway.lbourgon.workers.dev/api/preflight/vel');
    assert.equal(requests[0].init.redirect, 'error');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer fixture-private-key');
    assert.deepEqual(JSON.parse(requests[0].init.body), { include_cycle: false });
    assert.equal(result.source, 'pulsesync');
    assert.equal(result.verification, 'haven-authenticated-owner');
    assert.equal(result.privacy.raw_values_included, false);
    assert.equal('raw_samples' in result, false);
    assert.equal('unexpected_private_value' in result, false);
  });

  it('degrades honestly when the lane is absent, denied, or violates privacy', async () => {
    const missing = await readHavenVelPreflight({}, true);
    assert.equal(missing.queried, false);
    assert.equal(missing.freshness.state, 'unavailable');
    assert.equal(missing.freshness.reason, 'lane_not_configured');

    const denied = await readHavenVelPreflight(
      { VEL_PREFLIGHT_HAVEN_API_KEY: 'wrong' },
      true,
      async () => new Response('denied', { status: 401 }),
    );
    assert.equal(denied.freshness.reason, 'preflight_unavailable');

    const unsafe = await readHavenVelPreflight(
      { VEL_PREFLIGHT_HAVEN_API_KEY: 'fixture' },
      true,
      async () => Response.json({
        ...validContext,
        privacy: { raw_values_included: true, medical_interpretation: false },
      }),
    );
    assert.equal(unsafe.freshness.reason, 'contract_invalid');
  });

  it('builds only a compact, non-diagnostic pacing prompt', () => {
    const prompt = buildHavenVelPreflightPrompt({
      queried: true,
      source: 'pulsesync',
      verification: 'haven-authenticated-owner',
      latest_receipt_at: '2026-07-28T22:00:00Z',
      freshness: { state: 'fresh', age_bucket: '1_to_6h', reason: null },
      capacity: {
        state: 'limited',
        pacing: ['prefer_shorter_reply'],
        basis_freshness: { spoons: 'fresh', daily_demands: 'fresh' },
      },
      privacy: { raw_values_included: false, medical_interpretation: false },
    });
    assert.match(prompt, /Use it silently to adjust pace/);
    assert.match(prompt, /freshness: fresh; capacity: limited/);
    assert.match(prompt, /prefer_shorter_reply/);
    assert.doesNotMatch(prompt, /heart_rate|raw_samples|999|2026-07-28T22:00:00Z/);
  });
});
