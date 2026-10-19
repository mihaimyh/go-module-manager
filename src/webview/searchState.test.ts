import { describe, expect, it } from 'vitest';
import type { SearchResponse, SearchResult } from '../core/adapter';
import { emptySearchState, finishSearch, startSearch } from './searchState';

function item(name: string): SearchResult {
  return { name, version: 'v1.0.0', summary: '' };
}

function page(items: readonly SearchResult[], nextPageToken?: string): SearchResponse {
  return {
    query: 'cobra',
    items,
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
  };
}

describe('Browse search state', () => {
  it('keeps rows and the page token when an appended page fails', () => {
    const first = finishSearch(
      startSearch(emptySearchState, false),
      page([item('github.com/spf13/cobra')], 'page-2'),
      false,
    );
    const failed = finishSearch(startSearch(first, true), page([]), true, 'timeout');

    expect(failed.items).toEqual(first.items);
    expect(failed.nextPageToken).toBe('page-2');
    expect(failed.loadingAppend).toBe(false);
    expect(failed.appendError).toBe('timeout');
    expect(failed.generation).toBe(first.generation);
  });

  it('appends unique rows and advances the token', () => {
    const first = finishSearch(
      startSearch(emptySearchState, false),
      page([item('a'), item('b')], 'page-2'),
      false,
    );
    const second = finishSearch(
      startSearch(first, true),
      page([item('b'), item('c')], 'page-3'),
      true,
    );

    expect(second.items.map((entry) => entry.name)).toEqual(['a', 'b', 'c']);
    expect(second.nextPageToken).toBe('page-3');
    expect(second.appendError).toBeUndefined();
    expect(second.generation).toBe(first.generation);
  });

  it('stops paginating when a page adds no new rows', () => {
    const first = finishSearch(
      startSearch(emptySearchState, false),
      page([item('a')], 'page-2'),
      false,
    );
    const repeated = finishSearch(
      startSearch(first, true),
      page([item('a')], 'page-3'),
      true,
    );

    expect(repeated.items.map((entry) => entry.name)).toEqual(['a']);
    expect(repeated.nextPageToken).toBeUndefined();
  });

  it('replaces rows on a fresh query even while the previous rows are visible', () => {
    const first = finishSearch(
      startSearch(emptySearchState, false),
      page([item('a')], 'page-2'),
      false,
    );
    const pending = startSearch(first, false);

    expect(pending.items).toEqual(first.items);
    expect(pending.loadingFresh).toBe(true);
    expect(pending.loadingAppend).toBe(false);

    const settled = finishSearch(
      { ...pending, settledQuery: 'cobra' },
      { query: 'viper', items: [item('v')] },
      false,
    );

    expect(settled.items.map((entry) => entry.name)).toEqual(['v']);
    expect(settled.nextPageToken).toBeUndefined();
    expect(settled.error).toBeUndefined();
    expect(settled.generation).toBe(first.generation + 1);
  });

  it('clears rows and bumps the generation when a fresh query fails', () => {
    const first = finishSearch(
      startSearch(emptySearchState, false),
      page([item('a')], 'page-2'),
      false,
    );
    const failed = finishSearch(
      startSearch(first, false),
      { query: 'viper', items: [] },
      false,
      'network down',
    );

    expect(failed.items).toEqual([]);
    expect(failed.nextPageToken).toBeUndefined();
    expect(failed.error).toBe('network down');
    expect(failed.loadingFresh).toBe(false);
    expect(failed.generation).toBe(first.generation + 1);
  });
});
