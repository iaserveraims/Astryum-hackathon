/**
 * `User.preferences` carries `security`
 * (credentialsEpoch / takeoverAt). A request that rewrites the whole JSON from a
 * stale read erased it and undid an account takeover. The race itself (with the
 * real AuthService takeover) is covered in AuthService.oauthTakeover.test.ts;
 * here: the pure merge rules and a tripwire that no other file writes the column.
 */
jest.mock('../../../database/prismaClient', () => ({ prisma: {} }));

import fs from 'fs';
import path from 'path';
import {
  PREFERENCES_UNREADABLE_DETAIL,
  applyPreferencesUpdate,
  isPreferencesUnreadable,
  isReadablePreferencesColumn,
  withoutReservedKeys,
} from '../userPreferences';
import { QUARANTINED_PREFERENCES_KEY, readTakeoverAtStrict, withCredentialsReset } from '../credentialsEpoch';

describe('withoutReservedKeys', () => {
  it('strips security and tolerates garbage', () => {
    expect(withoutReservedKeys({ security: { a: 1 }, legal: 1 })).toEqual({ legal: 1 });
    expect(withoutReservedKeys(null)).toEqual({});
    expect(withoutReservedKeys([1, 2])).toEqual({});
    expect(withoutReservedKeys('x')).toEqual({});
  });
});

describe('applyPreferencesUpdate', () => {
  const security = { credentialsEpoch: '2026-09-13T00:00:00.000Z', takeoverAt: '2026-09-13T00:00:00.000Z' };

  it('keeps the current security whatever the updater returns', () => {
    expect(applyPreferencesUpdate({ security, a: 1 }, (p) => ({ ...p, b: 2 }))).toEqual({ a: 1, b: 2, security });
    expect(applyPreferencesUpdate({ security }, () => ({ security: null }))).toEqual({ security });
    expect(applyPreferencesUpdate({ security }, () => ({}))).toEqual({ security });
  });

  it('never lets the updater add security where there was none', () => {
    expect(applyPreferencesUpdate({ a: 1 }, (p) => ({ ...p, security: { credentialsEpoch: 'x' } }))).toEqual({ a: 1 });
    expect(applyPreferencesUpdate(null, () => ({ security: {} }))).toEqual({});
  });

  /**
   * 1.8 — THE WHOLE COLUMN IS CORRUPT.
   *
   * `asObject(current) ?? {}` made a non-object column indistinguishable from an
   * empty one, so the next write persisted a clean object with NO `security` —
   * and a row with no `security` reads downstream as «there was no takeover»,
   * which resurrects every binding the previous holder attached.
   */
  describe('a column that is not an object is never written over', () => {
    it.each([
      ['a string', 'not-an-object'],
      ['an array', [1, 2, 3]],
      ['a number', 7],
      ['a boolean', true],
    ])('refuses on %s — 409, not retryable, and the updater is never even run', (_name, corrupt) => {
      const updater = jest.fn((p: Record<string, unknown>) => ({ ...p, appearance: { theme: 'dark' } }));
      expect(() => applyPreferencesUpdate(corrupt, updater)).toThrow('preferences_unreadable');
      expect(updater).not.toHaveBeenCalled();
      try {
        applyPreferencesUpdate(corrupt, updater);
      } catch (e) {
        expect(isPreferencesUnreadable(e)).toBe(true);
        expect(e).toMatchObject({ status: 409, retryable: false, detail: PREFERENCES_UNREADABLE_DETAIL });
      }
    });

    it('null / undefined / {} are readable — a brand-new row still works', () => {
      expect(isReadablePreferencesColumn(null)).toBe(true);
      expect(isReadablePreferencesColumn(undefined)).toBe(true);
      expect(isReadablePreferencesColumn({})).toBe(true);
      expect(isReadablePreferencesColumn('x')).toBe(false);
      expect(applyPreferencesUpdate(null, (p) => ({ ...p, a: 1 }))).toEqual({ a: 1 });
    });

    it('the refusal names a way forward and never promises a retry', () => {
      expect(PREFERENCES_UNREADABLE_DETAIL).toMatch(/nothing was changed/i);
      expect(PREFERENCES_UNREADABLE_DETAIL).toMatch(/Waiting will not fix it/i);
      expect(PREFERENCES_UNREADABLE_DETAIL).toMatch(/administrator/i);
    });

    /**
     * The takeover is the one writer that cannot refuse, so it quarantines the
     * raw value and writes a well-formed `security` on top: readable afterwards,
     * and nothing destroyed.
     */
    it('the takeover path quarantines instead — and the row comes out READABLE', () => {
      const at = new Date('2026-09-15T08:00:00.000Z');
      const out = withCredentialsReset('not-an-object', at);
      expect(out[QUARANTINED_PREFERENCES_KEY]).toBe('not-an-object');
      expect(readTakeoverAtStrict(out)).toEqual({ readable: true, at });
      // And the quarantined value is reserved: no caller sees it or writes it.
      expect(withoutReservedKeys(out)).toEqual({});
      expect(applyPreferencesUpdate(out, (p) => ({ ...p, [QUARANTINED_PREFERENCES_KEY]: 'forged' }))[
        QUARANTINED_PREFERENCES_KEY
      ]).toBe('not-an-object');
    });
  });

  it('hands the updater a view without security', () => {
    const seen: unknown[] = [];
    applyPreferencesUpdate({ security, legal: { v: 1 } }, (p) => {
      seen.push(p);
      return p;
    });
    expect(seen).toEqual([{ legal: { v: 1 } }]);
  });
});

describe('tripwire — only the atomic helper (and the takeover / sign-up in AuthService) write User.preferences', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const ALLOWED = new Set(
    ['services/AuthService.ts', 'services/identity/userPreferences.ts'].map((p) => path.join(SRC, p)),
  );
  /**
   * The patterns used to be anchored to ONE line (`[^\n]*`), so the same write
   * split across lines — the shape prettier produces the moment the object grows
   * — walked straight past the tripwire (it. 14, menores). Every file is
   * normalised first (comments stripped, whitespace collapsed) and the patterns
   * then span the whole call, bounded by the statement's `;`.
   */
  const WRITE_PATTERNS = [
    // `preferences: <value> as never|object|any|Prisma…`, however it is wrapped
    /\bpreferences\s*:\s*(?!true\b)[^;]{0,400}?\bas\s+(?:never|object|any|Prisma\b)/,
    // `data: { preferences …`
    /\bdata\s*:\s*\{\s*preferences\b/,
    // any user write whose payload names the column (a `select` of it is not a
    // write, hence the `true` exclusion)
    /\buser\s*\.\s*(?:update|updateMany|upsert|create|createMany)\s*\(\s*\{[^;]{0,600}?\bpreferences\s*:\s*(?!true\b)/,
    // and the column touched through raw SQL
    /UPDATE\s+"?users"?\b[^;]{0,300}?\bpreferences\b/i,
  ];

  /** Comments out, whitespace collapsed: a write cannot hide behind a newline. */
  function normalise(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ');
  }

  it('catches a write split across lines (the shape that used to slip through)', () => {
    const multiline = normalise(`
      await tx.user.update({
        where: { id: userId },
        data: {
          preferences:
            next as never,
        },
      });
    `);
    expect(WRITE_PATTERNS.some((re) => re.test(multiline))).toBe(true);

    const commented = normalise(`
      // data: { preferences: forged as never }
      const x = 1;
    `);
    expect(WRITE_PATTERNS.some((re) => re.test(commented))).toBe(false);

    const justReading = normalise(`
      const row = await tx.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
    `);
    expect(WRITE_PATTERNS.some((re) => re.test(justReading))).toBe(false);
  });

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
  }

  it('finds no whole-object preferences write outside the allowed files', () => {
    const offenders = walk(SRC)
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => {
        const text = normalise(fs.readFileSync(file, 'utf8'));
        return WRITE_PATTERNS.some((re) => re.test(text));
      })
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('the three auth.ts writers go through updateUserPreferences', () => {
    const text = fs.readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8');
    expect(text.match(/updateUserPreferences\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
