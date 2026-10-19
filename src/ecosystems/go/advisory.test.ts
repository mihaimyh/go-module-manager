import { describe, expect, it } from 'vitest';
import { matchAdvisories, type AdvisoryDocument } from './advisory';

const sampler: AdvisoryDocument = {
  id: 'GO-0000-00001',
  summary: 'reachable in sampler.DefaultText',
  ranges: [{ module: 'rsc.io/sampler', introduced: '0', fixed: 'v1.99.99' }],
};

describe('matchAdvisories', () => {
  it('matches a version inside the affected range and reports the fixed version', () => {
    const result = matchAdvisories([sampler], [
      { name: 'rsc.io/sampler', version: 'v1.3.0' },
    ]);

    expect(result.get('rsc.io/sampler@v1.3.0')).toEqual([
      {
        id: 'GO-0000-00001',
        summary: 'reachable in sampler.DefaultText',
        fixedIn: 'v1.99.99',
      },
    ]);
  });

  it('does not match at or above the fixed bound', () => {
    expect(
      matchAdvisories([sampler], [{ name: 'rsc.io/sampler', version: 'v1.99.99' }]).size,
    ).toBe(0);
    expect(
      matchAdvisories([sampler], [{ name: 'rsc.io/sampler', version: 'v2.0.0' }]).size,
    ).toBe(0);
  });

  it('does not match a different module', () => {
    expect(
      matchAdvisories([sampler], [{ name: 'rsc.io/quote', version: 'v1.5.1' }]).size,
    ).toBe(0);
  });

  it('respects an introduced bound', () => {
    const document: AdvisoryDocument = {
      id: 'GO-0000-00002',
      summary: 'only the 1.4 line',
      ranges: [{ module: 'example.com/m', introduced: 'v1.4.0', fixed: 'v1.5.0' }],
    };

    expect(
      matchAdvisories([document], [{ name: 'example.com/m', version: 'v1.3.9' }]).size,
    ).toBe(0);
    expect(
      matchAdvisories([document], [{ name: 'example.com/m', version: 'v1.4.0' }]).size,
    ).toBe(1);
    expect(
      matchAdvisories([document], [{ name: 'example.com/m', version: 'v1.5.0' }]).size,
    ).toBe(0);
  });

  it('reports every advisory affecting one module', () => {
    const second: AdvisoryDocument = {
      id: 'GO-0000-00003',
      summary: 'another one',
      ranges: [{ module: 'rsc.io/sampler', introduced: 'v1.0.0' }],
    };

    const result = matchAdvisories([sampler, second], [
      { name: 'rsc.io/sampler', version: 'v1.3.0' },
    ]);

    expect(result.get('rsc.io/sampler@v1.3.0')?.map((advisory) => advisory.id)).toEqual([
      'GO-0000-00001',
      'GO-0000-00003',
    ]);
  });

  it('leaves a version that cannot be parsed unmatched', () => {
    expect(
      matchAdvisories([sampler], [{ name: 'rsc.io/sampler', version: 'workspace' }]).size,
    ).toBe(0);
  });
});

describe('version keying and odd bounds', () => {
  it('keys matches by version so two projects can differ', () => {
    const result = matchAdvisories([sampler], [
      { name: 'rsc.io/sampler', version: 'v1.3.0' },
      { name: 'rsc.io/sampler', version: 'v1.99.99' },
    ]);

    expect(result.has('rsc.io/sampler@v1.3.0')).toBe(true);
    expect(result.has('rsc.io/sampler@v1.99.99')).toBe(false);
  });

  it('does not suppress a match when the fixed bound is not SemVer', () => {
    const document: AdvisoryDocument = {
      id: 'GO-0000-00009',
      summary: 'toolchain range',
      ranges: [{ module: 'stdlib', introduced: '0', fixed: 'go1.21.2' }],
    };

    expect(
      matchAdvisories([document], [{ name: 'stdlib', version: 'v1.20.0' }]).size,
    ).toBe(1);
  });
});

describe('multiple ranges for one module', () => {
  it('reports the lowest fixed bound among the affecting ranges', () => {
    const document: AdvisoryDocument = {
      id: 'GO-0000-00010',
      summary: 'two intervals',
      ranges: [
        { module: 'example.com/m', introduced: 'v1.0.0' },
        { module: 'example.com/m', introduced: 'v1.0.0', fixed: 'v1.4.0' },
        { module: 'example.com/m', introduced: 'v1.0.0', fixed: 'v1.3.0' },
      ],
    };

    const result = matchAdvisories([document], [
      { name: 'example.com/m', version: 'v1.2.0' },
    ]);

    expect(result.get('example.com/m@v1.2.0')?.[0]?.fixedIn).toBe('v1.3.0');
  });
});
