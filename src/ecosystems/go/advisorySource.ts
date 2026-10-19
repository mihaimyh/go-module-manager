import { advisoryKey, type AdvisoryTarget } from '../../core/model';
import {
  matchAdvisories,
  type AdvisoryDocument,
  type AdvisoryReport,
  type AdvisorySource,
} from './advisory';
import { createPrivateMatcher } from './private';
import type { GoRunner } from './runner';

const INDEX_DB_URL = 'https://vuln.go.dev/index/db.json';
const INDEX_MODULES_URL = 'https://vuln.go.dev/index/modules.json';
const DOCUMENT_URL = 'https://vuln.go.dev/ID/';
const FETCH_TIMEOUT_MS = 30_000;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IndexEntry {
  readonly id: string;
  readonly modified: string;
  readonly fixed?: string;
}

export interface CachedAdvisoryDb {
  readonly fetchedAt: string;
  readonly dbModified: string;
  readonly index: Readonly<Record<string, readonly IndexEntry[]>>;
  readonly documents: Readonly<Record<string, AdvisoryDocument>>;
}

export interface AdvisoryCache {
  read(): Promise<CachedAdvisoryDb | undefined>;
  write(db: CachedAdvisoryDb): Promise<void>;
}

export interface AdvisorySourceDeps {
  /** HTTP seam: returns parsed JSON for a URL. */
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly cache: AdvisoryCache;
  readonly runner: GoRunner;
  readonly now?: () => number;
}

/**
 * The live advisory database: one `db.json` check per lookup, one
 * `modules.json` fetch per TTL or database change, and one document per
 * advisory we actually matched. Documents for a new dependency are fetched even
 * when the index is still cached.
 */
export function createLiveAdvisorySource(deps: AdvisorySourceDeps): AdvisorySource {
  const now = deps.now ?? Date.now;
  const matcher = createPrivateMatcher(deps.runner);

  return {
    async lookup(targets, options = {}) {
      const unchecked = new Set<string>();
      const publicTargets: AdvisoryTarget[] = [];
      for (const target of targets) {
        if (await matcher.isPrivate(target.name)) {
          unchecked.add(advisoryKey(target.name, target.version));
        } else {
          publicTargets.push(target);
        }
      }

      if (publicTargets.length === 0) {
        return { matches: new Map(), unchecked, stale: false };
      }

      const cached = await deps.cache.read();

      let dbModified: string;
      try {
        dbModified = readDbModified(await deps.fetchJson(INDEX_DB_URL));
      } catch (error) {
        if (cached !== undefined) {
          return report(cached, publicTargets, unchecked, true);
        }
        throw error;
      }

      const fresh = options.fresh === true;
      const age =
        cached === undefined ? Number.POSITIVE_INFINITY : now() - Date.parse(cached.fetchedAt);
      const reusable =
        cached !== undefined && !fresh && cached.dbModified === dbModified && age < CACHE_TTL_MS;

      try {
        const index = reusable ? cached.index : readIndex(await deps.fetchJson(INDEX_MODULES_URL));
        const documents = { ...(cached?.documents ?? {}) };
        let addedDocument = false;

        for (const target of publicTargets) {
          for (const entry of index[target.name] ?? []) {
            if (documents[entry.id] !== undefined) {
              continue;
            }
            const document = readDocument(await deps.fetchJson(`${DOCUMENT_URL}${entry.id}.json`));
            if (document !== undefined) {
              documents[entry.id] = document;
              addedDocument = true;
            }
          }
        }

        const next: CachedAdvisoryDb =
          reusable && !addedDocument
            ? cached
            : {
                fetchedAt: reusable ? cached.fetchedAt : new Date(now()).toISOString(),
                dbModified,
                index,
                documents,
              };

        if (next !== cached) {
          await deps.cache.write(next);
        }
        return report(next, publicTargets, unchecked, false);
      } catch (error) {
        if (cached !== undefined) {
          return report(cached, publicTargets, unchecked, true);
        }
        throw error;
      }
    },
  };
}

function report(
  db: CachedAdvisoryDb,
  targets: readonly AdvisoryTarget[],
  unchecked: ReadonlySet<string>,
  stale: boolean,
): AdvisoryReport {
  return {
    matches: matchAdvisories(Object.values(db.documents), targets),
    unchecked,
    fetchedAt: db.fetchedAt,
    stale,
  };
}

function readDbModified(value: unknown): string {
  const modified = (value as { modified?: unknown } | null)?.modified;
  if (typeof modified !== 'string') {
    throw new Error('vuln.go.dev returned an unexpected db.json');
  }
  return modified;
}

function readIndex(value: unknown): Record<string, readonly IndexEntry[]> {
  if (!Array.isArray(value)) {
    throw new Error('vuln.go.dev returned an unexpected modules.json');
  }

  const index: Record<string, readonly IndexEntry[]> = {};
  for (const entry of value) {
    const path = (entry as { path?: unknown } | null)?.path;
    const vulns = (entry as { vulns?: unknown } | null)?.vulns;
    if (typeof path !== 'string' || !Array.isArray(vulns)) {
      continue;
    }
    index[path] = vulns.flatMap((vuln): IndexEntry[] => {
      const id = (vuln as { id?: unknown } | null)?.id;
      const modified = (vuln as { modified?: unknown } | null)?.modified;
      const fixed = (vuln as { fixed?: unknown } | null)?.fixed;
      if (typeof id !== 'string' || typeof modified !== 'string') {
        return [];
      }
      return [{ id, modified, ...(typeof fixed === 'string' ? { fixed } : {}) }];
    });
  }
  return index;
}

/** Keeps every range in the document, so one cached document serves all modules. */
function readDocument(value: unknown): AdvisoryDocument | undefined {
  const record = value as
    | { id?: unknown; summary?: unknown; affected?: unknown }
    | null;
  if (record === null || typeof record.id !== 'string') {
    return undefined;
  }

  const ranges = Array.isArray(record.affected)
    ? record.affected.flatMap((entry) => {
        const module = (entry as { package?: { name?: unknown } } | null)?.package?.name;
        if (typeof module !== 'string') {
          return [];
        }
        const list = (entry as { ranges?: unknown } | null)?.ranges;
        if (!Array.isArray(list)) {
          return [];
        }
        return list.flatMap((range) => {
          const events = (range as { events?: unknown } | null)?.events;
          if (!Array.isArray(events)) {
            return [];
          }
          const introduced = events.find(
            (event): event is { introduced: string } =>
              typeof (event as { introduced?: unknown }).introduced === 'string',
          )?.introduced;
          const fixed = events.find(
            (event): event is { fixed: string } =>
              typeof (event as { fixed?: unknown }).fixed === 'string',
          )?.fixed;
          return [
            {
              module,
              ...(introduced === undefined ? {} : { introduced }),
              ...(fixed === undefined ? {} : { fixed }),
            },
          ];
        });
      })
    : [];

  return {
    id: record.id,
    summary: typeof record.summary === 'string' ? record.summary : record.id,
    ranges,
  };
}

export { FETCH_TIMEOUT_MS };
