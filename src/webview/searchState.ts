import type { SearchResponse, SearchResult } from '../core/adapter';

/**
 * Browse search state. A query and its next pages are one sequence: a page is
 * appended to the current results, a new query replaces them.
 */
export interface SearchState {
  readonly items: readonly SearchResult[];
  readonly nextPageToken?: string;
  readonly loadingFresh: boolean;
  readonly loadingAppend: boolean;
  readonly error?: string;
  readonly appendError?: string;
  /** The query whose page is on screen; anything else means a search is pending. */
  readonly settledQuery: string;
  /** Bumped whenever a fresh query settles, so the list can scroll back to the top. */
  readonly generation: number;
}

export const emptySearchState: SearchState = {
  items: [],
  loadingFresh: false,
  loadingAppend: false,
  settledQuery: '',
  generation: 0,
};

export function startSearch(state: SearchState, append: boolean): SearchState {
  return append
    ? { ...state, loadingAppend: true, appendError: undefined }
    : {
        ...state,
        loadingFresh: true,
        loadingAppend: false,
        error: undefined,
        appendError: undefined,
      };
}

export function finishSearch(
  state: SearchState,
  response: SearchResponse,
  append: boolean,
  error?: string,
): SearchState {
  if (append) {
    if (error !== undefined) {
      // Keep both the rows and the page token: the footer offers a retry for
      // the same page instead of dropping the sequence.
      return { ...state, loadingAppend: false, appendError: error };
    }

    const items = mergeUnique(state.items, response.items);
    return {
      ...state,
      items,
      // A page that adds nothing new would make the sentinel request the same
      // page forever, so stop paginating.
      nextPageToken: items.length === state.items.length ? undefined : response.nextPageToken,
      loadingAppend: false,
      appendError: undefined,
      settledQuery: response.query,
    };
  }

  const generation = state.generation + 1;
  if (error !== undefined) {
    return {
      ...state,
      items: [],
      nextPageToken: undefined,
      loadingFresh: false,
      error,
      appendError: undefined,
      settledQuery: response.query,
      generation,
    };
  }

  return {
    ...state,
    items: response.items,
    nextPageToken: response.nextPageToken,
    loadingFresh: false,
    error: undefined,
    appendError: undefined,
    settledQuery: response.query,
    generation,
  };
}

function mergeUnique(
  previous: readonly SearchResult[],
  page: readonly SearchResult[],
): readonly SearchResult[] {
  const seen = new Set(previous.map((item) => item.name));
  const merged = [...previous];
  for (const item of page) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      merged.push(item);
    }
  }
  return merged;
}
