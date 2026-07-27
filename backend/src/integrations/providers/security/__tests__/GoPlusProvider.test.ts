import { summarizeToken } from '../GoPlusProvider';

describe('GoPlusProvider.summarizeToken — KWYH verdict (D8)', () => {
  test('clean token → safe', () => {
    const s = summarizeToken(1, '0x' + '1'.repeat(40), {
      is_honeypot: '0',
      buy_tax: '0',
      sell_tax: '0',
      is_blacklisted: '0',
      is_mintable: '0',
      is_open_source: '1',
    });
    expect(s.verdict).toBe('safe');
    expect(s.flags).toEqual([]);
    expect(s.isOpenSource).toBe(true);
  });

  test('honeypot → danger', () => {
    const s = summarizeToken(1, '0x' + '2'.repeat(40), { is_honeypot: '1', is_open_source: '1' });
    expect(s.verdict).toBe('danger');
    expect(s.flags).toContain('honeypot');
  });

  test('high sell tax + mintable → caution with flags', () => {
    const s = summarizeToken(1, '0x' + '3'.repeat(40), {
      is_honeypot: '0',
      buy_tax: '0.02',
      sell_tax: '0.15', // 15%
      is_mintable: '1',
      is_open_source: '1',
    });
    expect(s.verdict).toBe('caution');
    expect(s.sellTaxPct).toBe(15);
    expect(s.flags).toEqual(expect.arrayContaining(['high_tax', 'mintable']));
  });

  test('blacklist-capable → danger', () => {
    const s = summarizeToken(1, '0x' + '4'.repeat(40), { is_blacklisted: '1', is_open_source: '1' });
    expect(s.verdict).toBe('danger');
    expect(s.flags).toContain('blacklist_capable');
  });

  test('no data → unknown (no invented verdict)', () => {
    const s = summarizeToken(1, '0x' + '5'.repeat(40), {});
    expect(s.verdict).toBe('unknown');
  });
});
