import { test, expect } from 'vitest';
import { settledResults } from '../src/settled-results.js';

test('preserves the input order of successful parallel results', async () => {
  await expect(settledResults([Promise.resolve('first'), Promise.resolve('second')])).resolves.toEqual(['first', 'second']);
});

test('does not finish on a failure while sibling requests are pending', async () => {
  let release, finished = false;
  const pending = new Promise(resolve => { release = resolve; });
  const error = new Error('failed');
  const result = settledResults([Promise.reject(error), pending]).catch(reason => { finished = true; return reason; });
  await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(false);
  release('done');
  expect(await result).toBe(error);
});
