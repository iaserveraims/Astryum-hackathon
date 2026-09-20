import { expect } from 'vitest';

/**
 * Pull ONE function out of a shipping .tsx and evaluate it.
 *
 * WHY IT EXISTS: the frontend vitest bootstrap is `environment: 'node'`, and
 * importing these components drags the wallet stack in (`Cannot find package
 * 'got'` from @aptos-labs/aptos-client, through useXrplWalletPartner). So the
 * decisions that must be COVERED — the ones that decide what a family may
 * press — are pulled out of the source and executed. The assertions then run
 * on the code that ships, not on a copy that can drift, and never on a
 * substring of it: a `toContain` over the source is how "only the two moves
 * that can succeed are offered" passed green while a third one was rendered
 * from another file.
 */
export function extract<T>(
  src: string,
  tsSignature: string,
  jsSignature: string,
  name: string,
  deps: Record<string, unknown> = {},
): T {
  const start = src.indexOf(tsSignature);
  expect(start, `${tsSignature} must exist in the shipping source`).toBeGreaterThan(-1);
  const js = jsSignature + src.slice(start + tsSignature.length);
  let depth = 0;
  let end = -1;
  for (let i = js.indexOf('{'); i < js.length; i += 1) {
    if (js[i] === '{') depth += 1;
    else if (js[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end, `${name} must be a balanced function body`).toBeGreaterThan(0);
  const depNames = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...depNames, `${js.slice(0, end)}; return ${name};`)(
    ...depNames.map((k) => deps[k]),
  ) as T;
}
