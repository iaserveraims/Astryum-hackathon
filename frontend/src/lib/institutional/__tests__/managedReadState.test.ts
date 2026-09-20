import { describe, expect, it } from 'vitest';
import { managedShelfView } from '../managedReadState';
import { shouldRefreshManagedSnapshot, MANAGED_SNAPSHOT_MAX_AGE_MS } from '../managedReadState';

/** «Could not read» is never headlined as «You have no managed vaults». */

const ok = { loading: false, positionsCount: 0, error: null, partial: false };

describe('managedShelfView', () => {
  it('empty only when every read answered', () => {
    expect(managedShelfView(ok)).toBe('empty');
  });

  it('a whole-pass error or a partial read with no positions is unreadable, not empty', () => {
    expect(managedShelfView({ ...ok, error: 'HTTP 502' })).toBe('unreadable');
    expect(managedShelfView({ ...ok, partial: true })).toBe('unreadable');
  });

  it('positions with a failed read are an incomplete list', () => {
    expect(managedShelfView({ ...ok, positionsCount: 2 })).toBe('list');
    expect(managedShelfView({ ...ok, positionsCount: 1, partial: true })).toBe('list-incomplete');
    expect(managedShelfView({ ...ok, positionsCount: 1, error: 'boom' })).toBe('list-incomplete');
  });

  it('loading with nothing yet is loading; a refresh keeps the known list on screen', () => {
    expect(managedShelfView({ ...ok, loading: true })).toBe('loading');
    expect(managedShelfView({ ...ok, loading: true, positionsCount: 1 })).toBe('list');
  });
});


describe('shouldRefreshManagedSnapshot — la estantería relee cuando toca', () => {
  const base = { loadedAt: 1_000_000, error: null, forAccount: 'tok-A', currentAccount: 'tok-A', inflight: false, now: 1_000_000 + 5_000 };

  it('never read → read', () => {
    expect(shouldRefreshManagedSnapshot({ ...base, loadedAt: 0 })).toBe(true);
  });

  it('a fresh pass for the same account is kept', () => {
    expect(shouldRefreshManagedSnapshot(base)).toBe(false);
  });

  it('ANOTHER account signed in (the 17-sep bug): the previous pass is not theirs', () => {
    expect(shouldRefreshManagedSnapshot({ ...base, currentAccount: 'tok-B' })).toBe(true);
    expect(shouldRefreshManagedSnapshot({ ...base, currentAccount: null })).toBe(true);
  });

  it('a pass older than a minute is reread — the manager may have moved the capital', () => {
    expect(shouldRefreshManagedSnapshot({ ...base, now: base.loadedAt + MANAGED_SNAPSHOT_MAX_AGE_MS + 1 })).toBe(true);
    expect(shouldRefreshManagedSnapshot({ ...base, now: base.loadedAt + MANAGED_SNAPSHOT_MAX_AGE_MS - 1 })).toBe(false);
  });

  it('a failed pass is retried; a pass in flight is never doubled', () => {
    expect(shouldRefreshManagedSnapshot({ ...base, error: 'boom' })).toBe(true);
    expect(shouldRefreshManagedSnapshot({ ...base, loadedAt: 0, inflight: true })).toBe(false);
  });
});
