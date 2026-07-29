const VEL_PREFLIGHT_URL = 'https://nexus-gateway.lbourgon.workers.dev/api/preflight/vel';
const REQUEST_TIMEOUT_MS = 5_000;

const FRESHNESS_STATES = new Set(['fresh', 'stale', 'unavailable']);
const CAPACITY_STATES = new Set(['low', 'limited', 'available', 'unknown']);
const SAFE_TOKEN = /^[a-z0-9_]{1,40}$/;

export interface HavenVelPreflightEnv {
  VEL_PREFLIGHT_HAVEN_API_KEY?: string;
}

export interface HavenVelPreflightContext {
  queried: boolean;
  source: 'pulsesync';
  verification: 'haven-authenticated-owner';
  latest_receipt_at: string | null;
  freshness: {
    state: 'fresh' | 'stale' | 'unavailable';
    age_bucket: string | null;
    reason: string | null;
  };
  capacity: {
    state: 'low' | 'limited' | 'available' | 'unknown';
    pacing: string[];
    basis_freshness: {
      spoons: string;
      daily_demands: string;
    };
  };
  privacy: {
    raw_values_included: false;
    medical_interpretation: false;
  };
  optional_context?: {
    cycle: string;
    freshness: {
      state: string;
      age_bucket: string | null;
      reason: string | null;
    };
  };
}

function unavailable(reason: string): HavenVelPreflightContext {
  return {
    queried: false,
    source: 'pulsesync',
    verification: 'haven-authenticated-owner',
    latest_receipt_at: null,
    freshness: { state: 'unavailable', age_bucket: null, reason },
    capacity: {
      state: 'unknown',
      pacing: [],
      basis_freshness: { spoons: 'unavailable', daily_demands: 'unavailable' },
    },
    privacy: { raw_values_included: false, medical_interpretation: false },
  };
}

function safeToken(value: unknown, fallback: string): string {
  const token = String(value || '');
  return SAFE_TOKEN.test(token) ? token : fallback;
}

function compactResponse(value: any): HavenVelPreflightContext | null {
  if (
    value?.queried !== true
    || value?.source !== 'pulsesync'
    || value?.verification !== 'haven-authenticated-owner'
    || value?.privacy?.raw_values_included !== false
    || value?.privacy?.medical_interpretation !== false
    || !FRESHNESS_STATES.has(value?.freshness?.state)
    || !CAPACITY_STATES.has(value?.capacity?.state)
  ) {
    return null;
  }

  const freshnessState = value.freshness.state as HavenVelPreflightContext['freshness']['state'];
  const capacityState = value.capacity.state as HavenVelPreflightContext['capacity']['state'];
  const context: HavenVelPreflightContext = {
    queried: true,
    source: 'pulsesync',
    verification: 'haven-authenticated-owner',
    latest_receipt_at: typeof value.latest_receipt_at === 'string' ? value.latest_receipt_at : null,
    freshness: {
      state: freshnessState,
      age_bucket: value.freshness.age_bucket == null ? null : safeToken(value.freshness.age_bucket, 'unknown'),
      reason: value.freshness.reason == null ? null : safeToken(value.freshness.reason, 'unavailable'),
    },
    capacity: {
      state: capacityState,
      pacing: Array.isArray(value.capacity.pacing)
        ? value.capacity.pacing.map(String).filter((item: string) => SAFE_TOKEN.test(item)).slice(0, 8)
        : [],
      basis_freshness: {
        spoons: safeToken(value.capacity.basis_freshness?.spoons?.state, 'unavailable'),
        daily_demands: safeToken(value.capacity.basis_freshness?.daily_demands?.state, 'unavailable'),
      },
    },
    privacy: { raw_values_included: false, medical_interpretation: false },
  };

  if (value.optional_context) {
    context.optional_context = {
      cycle: safeToken(value.optional_context.cycle, 'unavailable'),
      freshness: {
        state: safeToken(value.optional_context.freshness?.state, 'unavailable'),
        age_bucket: value.optional_context.freshness?.age_bucket == null
          ? null
          : safeToken(value.optional_context.freshness.age_bucket, 'unknown'),
        reason: value.optional_context.freshness?.reason == null
          ? null
          : safeToken(value.optional_context.freshness.reason, 'unavailable'),
      },
    };
  }

  return context;
}

export async function readHavenVelPreflight(
  env: HavenVelPreflightEnv,
  verifiedOwner: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<HavenVelPreflightContext | null> {
  // An unsecured or otherwise unverified Haven request performs no PulseSync
  // request at all.
  if (!verifiedOwner) return null;
  if (!env.VEL_PREFLIGHT_HAVEN_API_KEY) return unavailable('lane_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(VEL_PREFLIGHT_URL, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.VEL_PREFLIGHT_HAVEN_API_KEY}`,
      },
      body: JSON.stringify({ include_cycle: false }),
    });
    if (!response.ok) return unavailable('preflight_unavailable');
    const compact = compactResponse(await response.json());
    return compact || unavailable('contract_invalid');
  } catch {
    return unavailable('preflight_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export function buildHavenVelPreflightPrompt(context: HavenVelPreflightContext | null): string {
  if (!context) return '';
  const lines = [
    '## Private Vel Pacing Context',
    'Haven attached this only after verifying the single-owner auth token.',
    'Use it silently to adjust pace, reply length, urgency, and the number of decisions requested.',
    'Do not quote, announce, diagnose from, or expose this context to the user.',
    `Provenance: ${context.source}; freshness: ${context.freshness.state}; capacity: ${context.capacity.state}.`,
    context.capacity.pacing.length ? `Pacing: ${context.capacity.pacing.join(', ')}.` : 'Pacing: no additional flags.',
    `Privacy: raw values included = ${context.privacy.raw_values_included}; medical interpretation = ${context.privacy.medical_interpretation}.`,
  ];
  if (context.optional_context) lines.push(`Optional cycle bucket: ${context.optional_context.cycle}.`);
  return lines.join('\n');
}
