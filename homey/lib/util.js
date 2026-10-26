'use strict';

const DAY_MS = 86400000;

/**
 * Kitchey returns Postgres DATE columns as ISO timestamps at server-local midnight
 * (e.g. "2026-10-31T23:00:00.000Z" for 2026-11-01 on a Europe/Copenhagen server).
 * Shifting by 12 h before taking the UTC date yields the intended calendar day for
 * any server timezone within ±12 h. Plain "YYYY-MM-DD" strings are returned as-is.
 */
function toDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

function todayKey(timezone) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `today` (YYYY-MM-DD) until `dateValue`; null when no/invalid date. */
function daysUntil(dateValue, today) {
  const key = toDateKey(dateValue);
  if (!key) return null;
  return Math.round((keyToUtc(key) - keyToUtc(today)) / DAY_MS);
}

/** "28-10" style short date for dashboard strings. */
function shortDate(key) {
  if (!key) return '';
  const [, m, d] = key.split('-');
  return `${d}-${m}`;
}

function shoppingName(item) {
  return item.product_name || item.custom_name || '';
}

function norm(str) {
  return String(str || '').trim().toLowerCase();
}

/** Aggregate numbers for a set of (enriched) inventory items. */
function computeStats(items) {
  const stats = {
    count: 0,
    expiring3: 0,
    expiring7: 0,
    expired: 0,
    nextExpiring: null,
    latest: null,
  };
  for (const item of items) {
    stats.count += 1;
    const d = item.days_left;
    if (d !== null && d !== undefined) {
      if (d < 0) stats.expired += 1;
      else {
        if (d <= 3) stats.expiring3 += 1;
        if (d <= 7) stats.expiring7 += 1;
        if (!stats.nextExpiring || d < stats.nextExpiring.days_left) stats.nextExpiring = item;
      }
    }
    if (item.created_at && (!stats.latest || item.created_at > stats.latest.created_at)) {
      stats.latest = item;
    }
  }
  return stats;
}

module.exports = { toDateKey, todayKey, daysUntil, shortDate, shoppingName, norm, computeStats };
