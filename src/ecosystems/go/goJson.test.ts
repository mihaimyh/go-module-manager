import { describe, expect, it } from 'vitest';
import { parseGoModJson, parseJsonStream, parseModuleList } from './goJson';

describe('parseJsonStream', () => {
  it('splits concatenated objects', () => {
    expect(parseJsonStream('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('does not split on braces inside strings', () => {
    expect(parseJsonStream('{"Path":"a{b}"}{"Path":"c}d"}')).toEqual([
      { Path: 'a{b}' },
      { Path: 'c}d' },
    ]);
  });

  it('handles escaped quotes inside strings', () => {
    expect(parseJsonStream('{"Path":"a\\"b"}')).toEqual([{ Path: 'a"b' }]);
  });

  it('strips a byte order mark', () => {
    expect(parseJsonStream('\uFEFF{"a":1}')).toEqual([{ a: 1 }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseJsonStream('')).toEqual([]);
  });
});

describe('parseGoModJson', () => {
  it('reads requirements and the indirect marker', () => {
    const parsed = parseGoModJson(
      JSON.stringify({
        Module: { Path: 'example.com/a' },
        Go: '1.21',
        Require: [
          { Path: 'rsc.io/quote', Version: 'v1.5.1' },
          { Path: 'rsc.io/sampler', Version: 'v1.3.0', Indirect: true },
        ],
      }),
    );

    expect(parsed.Module?.Path).toBe('example.com/a');
    expect(parsed.Require).toHaveLength(2);
    expect(parsed.Require?.[1]?.Indirect).toBe(true);
  });
});

describe('parseModuleList', () => {
  it('drops entries that are not objects', () => {
    expect(parseModuleList('{"Path":"a"}\nnull\n')).toEqual([{ Path: 'a' }]);
  });
});
