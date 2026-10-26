/**
 * Host half of the dsh-price-chip bundle: aggregates today's DeepSeek spend in
 * CNY from the token usage recorded in every session log, and serves it to the
 * Client chip at `/model-pricing/usage`. The Client module owns all rendering.
 * @module dsh-price-chip
 */

// Price table: [off-peak, peak] per million tokens, in CNY. Mirrors the table in
// client.js; keep both in sync when DeepSeek publishes new prices.
const PRICES = {
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1.0, 2.0], out: [4.0, 8.0] },
  'deepseek-v4-pro': { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] },
};

// Peak = Beijing time, Monday-Friday, 09:00-12:00 and 14:00-18:00, on days that
// are not Chinese statutory holidays. Everything else is off-peak.
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
];

// 2026 statutory holiday ranges (inclusive), State Council notice.
const HOLIDAY_RANGES = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
];

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildHolidays() {
  const days = new Set();
  for (const [from, to] of HOLIDAY_RANGES) {
    const start = Date.parse(from + 'T00:00:00Z');
    const end = Date.parse(to + 'T00:00:00Z');
    for (let at = start; at <= end; at += DAY_MS) {
      const day = new Date(at);
      days.add(`${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`);
    }
  }
  return days;
}

const HOLIDAYS = buildHolidays();

/** Beijing-time calendar fields for one instant. */
function shanghaiParts(ms) {
  const shifted = new Date(ms + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

function dayKey(ms) {
  const parts = shanghaiParts(ms);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** @returns {'offpeak'|'peak'} */
function periodAt(ms) {
  const parts = shanghaiParts(ms);
  if (parts.weekday === 0 || parts.weekday === 6) return 'offpeak';
  if (HOLIDAYS.has(dayKey(ms))) return 'offpeak';
  const minutes = parts.hour * 60 + parts.minute;
  for (const [from, to] of PEAK_WINDOWS) {
    if (minutes >= from && minutes < to) return 'peak';
  }
  return 'offpeak';
}

/** First instant of the Beijing-time day containing `now`. */
function dayStartOf(now) {
  const parts = shanghaiParts(now);
  return Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET_MS;
}

/** Model carrying one assistant message: its source when present. */
function modelOf(data, fallback) {
  const source = data && data.message && data.message.source;
  if (source && typeof source.model === 'string' && source.model !== '') return source.model;
  return fallback;
}

function costOf(model, at, usage) {
  const table = PRICES[model];
  if (table === undefined || !usage) return null;
  const index = periodAt(at) === 'peak' ? 1 : 0;
  const hit = Number(usage.cacheReadTokens) || 0;
  const miss = Number(usage.inputTokens) || 0;
  const out = Number(usage.outputTokens) || 0;
  return {
    model,
    hit,
    miss,
    out,
    cny: (hit * table.hit[index] + miss * table.miss[index] + out * table.out[index]) / 1e6,
  };
}

/**
 * Sum today's assistant-call cost across every session log. The current live
 * session is included through its persisted log; inherited fork prefixes are
 * skipped so a forked log does not count its parent's calls twice.
 */
async function collectToday(ctx, now) {
  const startedAt = Date.now();
  const start = dayStartOf(now);
  let records = [];
  try {
    records = await ctx.sessionQuery.listSessions();
  } catch {
    return { ok: false, reason: 'session-query-failed', at: now };
  }
  let total = 0;
  let calls = 0;
  let sessions = 0;
  const models = {};
  for (const record of records) {
    const header = record && record.header;
    const id = header && header.id;
    if (typeof id !== 'string' || id === '') continue;
    let snapshot;
    try {
      snapshot = await ctx.sessionQuery.readSession(id);
    } catch {
      continue;
    }
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const inherited = Number(snapshot.inheritedEventCount) || 0;
    let fallbackModel = null;
    let touched = false;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!event || typeof event !== 'object') continue;
      if (event.type === 'request/context') {
        const config = event.data && event.data.config;
        if (config && typeof config.model === 'string') fallbackModel = config.model;
        continue;
      }
      if (event.type !== 'assistant/message') continue;
      if (typeof event.time !== 'number' || event.time < start) continue;
      if (index < inherited) continue;
      const model = modelOf(event.data, fallbackModel);
      const cost = costOf(model, event.time, event.data && event.data.usage);
      if (cost === null) continue;
      touched = true;
      calls += 1;
      total += cost.cny;
      const previous = models[cost.model] || { cny: 0, calls: 0 };
      models[cost.model] = { cny: previous.cny + cost.cny, calls: previous.calls + 1 };
    }
    if (touched) sessions += 1;
  }
  return {
    ok: true,
    todayCny: total,
    calls,
    sessions,
    models,
    dayStart: start,
    at: now,
    ms: Date.now() - startedAt,
  };
}

/** Client metadata the platform attributes a balance request to. */
const BALANCE_CLIENT = {
  version: '0.2.1-rc.3',
  locale: 'zh-CN',
  timezoneOffsetSeconds: 8 * 60 * 60,
};

/** CNY total of one wallet list, or null when the list carries no CNY wallet. */
function cnyTotal(wallets) {
  if (!Array.isArray(wallets)) return null;
  let total = 0;
  let seen = false;
  for (const wallet of wallets) {
    if (wallet === null || wallet === undefined || wallet.currency !== 'CNY') continue;
    const amount = Number(wallet.balance);
    if (!Number.isFinite(amount)) continue;
    seen = true;
    total += amount;
  }
  return seen ? total : null;
}

/** Spendable CNY balance of the signed-in account, or null when unknown. */
async function readBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null;
  if (account === null || account === undefined) return null;
  try {
    const snapshot = await account.getBalance(BALANCE_CLIENT);
    if (snapshot === null || snapshot === undefined || snapshot.status !== 'ready') return null;
    const paid = cnyTotal(snapshot.value);
    const bonus = cnyTotal(snapshot.bonusWallets);
    if (paid === null && bonus === null) return null;
    return { cny: (paid === null ? 0 : paid) + (bonus === null ? 0 : bonus), paid, bonus };
  } catch {
    return null;
  }
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.inject(['webServer', 'sessionQuery'], (ctx) => {
    let cache = null;
    let pending = null;
    let balanceCache = null;
    let balancePending = null;

    /** Balance changes rarely; one platform call per minute is plenty. */
    async function readCachedBalance(now) {
      if (balanceCache !== null && now - balanceCache.at < 60000) return balanceCache.value;
      if (balancePending !== null) return balancePending;
      balancePending = readBalance(ctx)
        .then((value) => {
          if (value !== null) balanceCache = { value, at: now };
          return value;
        })
        .finally(() => {
          balancePending = null;
        });
      return balancePending;
    }

    /** Serve one response, sharing a single in-flight aggregation. */
    async function readUsage() {
      const now = Date.now();
      if (cache !== null && now - cache.at < 20000) return cache;
      if (pending !== null) return pending;
      pending = collectToday(ctx, now)
        .then((value) => {
          if (value.ok) cache = value;
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    }

    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: '/model-pricing/usage',
          handler: async (req, res) => {
            try {
              const [usage, balance] = await Promise.all([readUsage(), readCachedBalance(Date.now())]);
              const body = JSON.stringify({ ...usage, balance });
              res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              });
              res.end(body);
            } catch (error) {
              res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
              res.end(String(error));
            }
          },
        }),
      'model-pricing: usage route',
    );
  });
}
