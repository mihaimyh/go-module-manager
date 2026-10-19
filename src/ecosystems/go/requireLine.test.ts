import { describe, expect, it } from 'vitest';
import { requireLineNumber } from './requireLine';

const goMod = [
  'module example.com/a',
  '',
  'go 1.21',
  '',
  'require (',
  '	rsc.io/quote v1.5.1',
  '	rsc.io/sampler v1.3.0 // indirect',
  ')',
].join('\n');

describe('requireLineNumber', () => {
  it('finds the 1-based line of a require', () => {
    expect(requireLineNumber(goMod, 'rsc.io/quote')).toBe(6);
    expect(requireLineNumber(goMod, 'rsc.io/sampler')).toBe(7);
  });

  it('returns undefined when the module is not required', () => {
    expect(requireLineNumber(goMod, 'example.com/missing')).toBeUndefined();
  });
});
