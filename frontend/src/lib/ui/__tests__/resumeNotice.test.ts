import { describe, expect, it } from 'vitest';
import { resumeSummary } from '../resumeNotice';

const st = (done: boolean[]) => done.map((d, i) => ({ label: `S${i}`, done: d }));

describe('resumeSummary', () => {
  it('landing on the first station says nothing', () => {
    expect(resumeSummary(0, st([false, false, false]))).toBeNull();
  });

  it('a landing further in, with the earlier stations done, is a resume', () => {
    expect(resumeSummary(2, st([true, true, false, false]))).toEqual({ label: 'S2', doneBefore: 2 });
  });

  it('a fully done ceremony that lands on its last station counts everything before it', () => {
    expect(resumeSummary(5, st([true, true, true, true, true, true]))).toEqual({ label: 'S5', doneBefore: 5 });
  });

  it('an optional station skipped on the way is not counted as done', () => {
    // reinforce: the constitution (4) is skipped, the ceremony lands on 5.
    expect(resumeSummary(5, st([true, true, true, true, false, true]))).toEqual({ label: 'S5', doneBefore: 4 });
  });

  it('a landing that skipped nothing done is not a resume', () => {
    expect(resumeSummary(1, st([false, false]))).toBeNull();
  });

  it('no landing yet, or one out of range, says nothing', () => {
    expect(resumeSummary(null, st([true, false]))).toBeNull();
    expect(resumeSummary(9, st([true, false]))).toBeNull();
    expect(resumeSummary(-1, st([true, false]))).toBeNull();
  });
});
