import { describe, expect, it } from 'vitest';
import { requiredModuleAtLine, requireLineNumber } from './requireLine';

const goMod = [
  'module example.com/a',
  '',
  'go 1.21',
  '',
  'require (',
  '	rsc.io/quote v1.5.1',
  '	rsc.io/sampler v1.3.0 // indirect',
  ')',
  '',
  'require golang.org/x/text v0.14.0 // indirect',
  '',
  'replace (',
  '	rsc.io/quote v1.5.1 => ../quote',
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

describe('requiredModuleAtLine', () => {
  it('parses module paths from block and single-line require directives, including indirect and quoted requirements', () => {
    expect(requiredModuleAtLine(goMod, 6)).toBe('rsc.io/quote');
    expect(requiredModuleAtLine(goMod, 7)).toBe('rsc.io/sampler');
    expect(requiredModuleAtLine(goMod, 10)).toBe('golang.org/x/text');
    expect(requiredModuleAtLine('require "example.com/quoted" v1.0.0\n', 1)).toBe(
      'example.com/quoted',
    );
  });

  it('returns undefined on non-require lines, replace blocks, comments, and out-of-range lines', () => {
    expect(requiredModuleAtLine(goMod, 1)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 3)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 5)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 8)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 13)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 14)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 0)).toBeUndefined();
    expect(requiredModuleAtLine(goMod, 99)).toBeUndefined();
  });
});

