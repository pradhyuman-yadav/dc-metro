import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock before importing lib/db
const mockDb = {
  pragma: vi.fn(),
  exec: vi.fn(),
  prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) })),
  transaction: vi.fn((fn: () => void) => fn),
};

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => mockDb),
}));

vi.mock('fs', () => ({
  default: { mkdirSync: vi.fn() },
  mkdirSync: vi.fn(),
}));

import Database from 'better-sqlite3';

// Import after mocks are in place — use dynamic import to avoid hoisting issues
const { getDb, isCacheStale, CACHE_TTL_SECONDS } = await import('@/lib/db');

describe('getDb', () => {
  it('returns the same instance on multiple calls (singleton)', () => {
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    expect(Database).toHaveBeenCalledTimes(1);
  });

  it('runs WAL pragma on first open', () => {
    expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
  });

  it('runs foreign_keys pragma on first open', () => {
    expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
  });

  it('runs CREATE TABLE IF NOT EXISTS statements', () => {
    expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS subway_routes'));
  });
});

describe('CACHE_TTL_SECONDS', () => {
  it('is 86400 (24 hours)', () => {
    expect(CACHE_TTL_SECONDS).toBe(86_400);
  });
});

describe('isCacheStale', () => {
  it('returns false for a timestamp fetched 1 hour ago', () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    expect(isCacheStale(oneHourAgo)).toBe(false);
  });

  it('returns true for a timestamp fetched 25 hours ago', () => {
    const twentyFiveHoursAgo = Math.floor(Date.now() / 1000) - 25 * 3600;
    expect(isCacheStale(twentyFiveHoursAgo)).toBe(true);
  });

  it('returns true for timestamp 0 (never fetched)', () => {
    expect(isCacheStale(0)).toBe(true);
  });
});
