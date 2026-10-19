import { useEffect, useMemo, useState } from 'react';
import type { PreviewResult } from '../core/adapter';
import type {
  DependencySelection,
  RecoveryAction,
  ReleaseNotes,
  ResolveProgress,
} from '../core/messages';
import { advisoryFixOffer, affectedRangeText } from '../core/advisoryAction';
import { groupedDivergence } from '../core/consolidate';
import { hasReachable } from '../core/scan';
import type { Advisory, DependencyRow, FailureKind, PanelModel } from '../core/model';
import { sortRows, type SortKey, type SortState } from '../core/sort';
import {
  compareVersions,
  pickerVersions,
  versionApplyOffer,
  type UpdateKind,
} from '../core/version';
import { Dropdown } from './Dropdown';
import {
  ArrowRightIcon,
  ExternalLinkIcon,
  MoreIcon,
  PackageIcon,
  RefreshIcon,
  SearchIcon,
  TerminalIcon,
  WarningIcon,
} from './icons';

const KIND_LABELS: Record<UpdateKind, string> = {
  none: 'up to date',
  patch: 'patch',
  minor: 'minor',
  major: 'major',
  prerelease: 'prerelease',
  release: 'release',
};

const RECOVERY: Record<FailureKind, { readonly action: RecoveryAction; readonly label: string }> = {
  'missing-lock-entry': { action: 'repair', label: 'Run go mod download' },
  'toolchain-missing': { action: 'install', label: 'Install Go' },
  'auth-required': { action: 'retry', label: 'Retry' },
  network: { action: 'retry', label: 'Retry' },
  verification: { action: 'clean-checksum-cache', label: 'Repair checksum cache' },
  timeout: { action: 'retry', label: 'Retry' },
  unknown: { action: 'retry', label: 'Retry' },
};

type Tab = 'dependencies' | 'updates' | 'vulnerabilities' | 'consolidate';

interface AppProps {
  readonly model: PanelModel | undefined;
  readonly progress?: ResolveProgress;
  readonly busy?: string;
  readonly versionsLoading: Readonly<Record<string, boolean>>;
  readonly clearSignal?: number;
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
  readonly onBulkUpdate: (selection: readonly DependencySelection[]) => void;
  readonly onTidy: (manifests: readonly string[]) => void;
  readonly onScan: (manifests: readonly string[]) => void;
  readonly onInstallScanner: () => void;
  readonly versions: Readonly<Record<string, readonly string[]>>;
  readonly onVersions: (modulePath: string) => void;
  readonly onOpenPanel: () => void;
  readonly onOpenManifest: (manifestPath: string, name: string) => void;
  readonly why: Readonly<Record<string, { readonly text?: string; readonly error?: string }>>;
  readonly onWhy: (manifestPath: string, name: string) => void;
  readonly releaseNotes: Readonly<Record<string, ReleaseNotes | null>>;
  readonly onReleaseNotes: (modulePath: string, version: string) => void;
  readonly preview?: PreviewResult;
  readonly onPreview: (manifestPath: string, name: string, version: string) => void;
}

export function App({
  model,
  progress,
  busy,
  versionsLoading,
  clearSignal,
  onRefresh,
  onRecover,
  onUpdate,
  onBulkUpdate,
  onTidy,
  onScan,
  onInstallScanner,
  versions,
  onVersions,
  onOpenPanel,
  onOpenManifest,
  why,
  onWhy,
  releaseNotes,
  onReleaseNotes,
  preview,
  onPreview,
}: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash === '#vulnerabilities'
      ? 'vulnerabilities'
      : window.location.hash === '#updates'
        ? 'updates'
        : window.location.hash === '#consolidate'
          ? 'consolidate'
          : 'dependencies',
  );
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [directOnly, setDirectOnly] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: 'module', direction: 'asc' });
  const [selectedId, setSelectedId] = useState<string>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [compact, setCompact] = useState(() => window.innerWidth < 720);

  useEffect(() => {
    const onResize = (): void => setCompact(window.innerWidth < 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if ((clearSignal ?? 0) > 0) {
      setChecked(new Set());
    }
  }, [clearSignal]);

  const rows = model?.rows ?? [];
  const projects = model?.projects ?? [];
  const failedManifests = useMemo(
    () =>
      new Set(
        projects
          .filter((project) => project.failure !== undefined)
          .map((project) => project.manifestPath),
      ),
    [projects],
  );
  const updates = rows.filter((row) => row.candidate !== undefined);

  // Tab counts follow Direct only and the owning module, so a tab never shows
  // a number the list cannot display. The search box narrows within a tab; it
  // only changes the "x of y" chip.
  const scopedRows = rows.filter(
    (row) =>
      (!directOnly || !row.transitive) &&
      (moduleFilter === 'all' || row.project === moduleFilter),
  );
  const scopedUpdates = scopedRows.filter((row) => row.candidate !== undefined);
  const scopedAdvisoryRows = scopedRows.filter((row) => row.advisories.length > 0);
  const scopedAdvisoryIds = new Set(
    scopedRows.flatMap((row) => row.advisories.map((advisory) => advisory.id)),
  );
  const consolidateGroups = groupedDivergence(scopedRows);
  const divergentCount = consolidateGroups.length;
  const tabRows =
    tab === 'updates'
      ? scopedUpdates
      : tab === 'vulnerabilities'
        ? scopedAdvisoryRows
        : tab === 'consolidate'
          ? consolidateGroups.flatMap((group) => group.rows)
          : scopedRows;

  const hiddenByDirect = !directOnly
    ? 0
    : tab === 'vulnerabilities'
      ? new Set(
          rows
            .filter((row) => row.transitive)
            .flatMap((row) => row.advisories.map((advisory) => advisory.id)),
        ).size
      : tab === 'updates'
        ? updates.filter((row) => row.transitive).length
        : rows.filter((row) => row.transitive).length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tabRows.filter(
      (row) => needle === '' || row.name.toLowerCase().includes(needle),
    );
  }, [tabRows, query]);

  const sorted = useMemo(() => sortRows(visible, sort), [visible, sort]);

  const toggleSort = (key: SortKey): void => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  };

  // Open on the row that needs attention within the current view: an advisory
  // first, then an update. A row hidden by the tab or filters is not selected.
  const activeId =
    sorted.find((row) => row.id === selectedId)?.id ??
    sorted.find((row) => row.advisories.length > 0)?.id ??
    sorted.find((row) => row.candidate !== undefined)?.id ??
    sorted[0]?.id;
  const selected = rows.find((row) => row.id === activeId);
  const visibleSelected = visible.filter((row) => checked.has(row.id));
  const hiddenSelected = Math.max(0, checked.size - visibleSelected.length);
  const updatable = visibleSelected.filter((row) => row.candidate !== undefined);
  const targetManifests = (() => {
    if (visibleSelected.length > 0) {
      return [...new Set(visibleSelected.map((row) => row.manifestPath))];
    }
    return selected === undefined ? [] : [selected.manifestPath];
  })();
  const reachable = model === undefined ? false : hasReachable(model);
  const scanState = (() => {
    if (projects.some((project) => project.scan?.status === 'running')) {
      return 'Scanning reachable code…';
    }
    const failed = projects.find((project) => project.scan?.status === 'failed')?.scan;
    if (failed !== undefined) {
      return `Scan failed: ${failed.message ?? 'unknown error'}`;
    }
    const at = projects
      .map((project) => project.scan?.at)
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1);
    return at === undefined
      ? 'not scanned yet.'
      : `Reachable code scanned ${ageOf(at)}.`;
  })();

  if (!model) {
    return (
      <div className="app loading-screen" role="status" aria-live="polite">
        <span className="spinner large" aria-hidden="true" />
        <p className="loading-title">Reading the workspace…</p>
        <p className="muted">Looking for go.mod files and their dependencies.</p>
      </div>
    );
  }

  const checking = progress !== undefined && progress.done < progress.total;
  // Any in-flight host work (writes, confirms, scans) or update lookup locks actions.
  const locked = busy !== undefined || checking;
  const statusLabel =
    busy ??
    (checking
      ? `Checking updates… ${progress.done}/${progress.total}${
          progress.project === undefined ? '' : ` · ${progress.project}`
        }`
      : undefined);
  const statusPercent =
    progress !== undefined && progress.total > 0 && checking
      ? Math.round((progress.done / progress.total) * 100)
      : undefined;

  const allChecked = visible.length > 0 && visible.every((row) => checked.has(row.id));

  const toggle = (id: string): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = (): void => {
    setChecked((current) => {
      const next = new Set(current);
      for (const row of visible) {
        if (allChecked) {
          next.delete(row.id);
        } else {
          next.add(row.id);
        }
      }
      return next;
    });
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="title">
            <PackageIcon />
            Go modules
          </span>
          <span className="count-chip">
            {visible.length} of {tabRows.length}
          </span>
          <span className="divider" aria-hidden="true" />
          <div className="search">
            <span className="search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              type="search"
              placeholder="Filter by module path"
              aria-label="Filter by module path"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {projects.length > 1 ? (
            <Dropdown
              label="Owning module"
              value={moduleFilter}
              options={[
                { value: 'all', label: `All modules (${projects.length})` },
                ...projects.map((project) => ({
                  value: project.name,
                  label: project.name,
                })),
              ]}
              onChange={setModuleFilter}
            />
          ) : null}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={directOnly}
              onChange={(event) => setDirectOnly(event.target.checked)}
            />
            Direct only
          </label>
        </div>

        <div className="toolbar-actions">
          {compact ? (
            <button
              type="button"
              className="button secondary"
              onClick={onOpenPanel}
              title="Open the full panel"
            >
              <ExternalLinkIcon />
              Open panel
            </button>
          ) : null}
          <button
            type="button"
            className="button secondary"
            onClick={() => onTidy(targetManifests)}
            disabled={locked || targetManifests.length === 0}
            title="Run go mod tidy in the selected projects"
          >
            <TerminalIcon />
            go mod tidy
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onRefresh}
            disabled={locked}
            title="Re-run the update lookup"
          >
            <RefreshIcon />
            Check for updates
          </button>
        </div>
      </header>

      {statusLabel !== undefined ? (
        <div className="status-strip" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="status-label">{statusLabel}</span>
          {statusPercent !== undefined ? (
            <span className="status-track" aria-hidden="true">
              <span className="status-fill" style={{ width: `${statusPercent}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}

      <nav className="tabs" aria-label="Views">
        <TabButton
          label="Dependencies"
          count={scopedRows.length}
          active={tab === 'dependencies'}
          onClick={() => setTab('dependencies')}
        />
        <TabButton
          label="Updates"
          count={scopedUpdates.length}
          active={tab === 'updates'}
          onClick={() => setTab('updates')}
        />
        <TabButton
          label="Vulnerabilities"
          count={scopedAdvisoryIds.size}
          tone={reachable ? 'danger' : 'warning'}
          active={tab === 'vulnerabilities'}
          onClick={() => setTab('vulnerabilities')}
        />
        <TabButton
          label="Consolidate"
          count={divergentCount}
          active={tab === 'consolidate'}
          onClick={() => setTab('consolidate')}
        />
        {checked.size > 0 ? (
          <span className="selection-count">
            {visibleSelected.length} selected
            {hiddenSelected > 0 ? ` · ${hiddenSelected} hidden by filters` : ''}
          </span>
        ) : null}
        {visibleSelected.length > 0 ? (
          <button
            type="button"
            className="button primary compact"
            disabled={locked || updatable.length === 0}
            title={
              updatable.length === 0
                ? 'Nothing in this selection has an update'
                : `Update ${updatable.length} dependencies${
                    visibleSelected.length - updatable.length > 0
                      ? `; ${visibleSelected.length - updatable.length} selected have no update`
                      : ''
                  }`
            }
            onClick={() =>
              onBulkUpdate(
                updatable.map((row) => ({ manifestPath: row.manifestPath, name: row.name })),
              )
            }
          >
            Update selected ({updatable.length})
          </button>
        ) : null}
      </nav>

      {model.projects.some((project) => project.failure !== undefined) ? (
        <div className="failures">
          {model.projects.map((project) => {
            const failure = project.failure;
            if (failure === undefined) {
              return null;
            }
            return (
              <div className="failure" role="alert" key={project.manifestPath}>
                <WarningIcon size={16} />
                <div className="failure-text">
                  <strong>{project.name}</strong>
                  <p className="mono">{failure.message}</p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={locked}
                  onClick={() =>
                    onRecover(project.manifestPath, RECOVERY[failure.kind].action)
                  }
                >
                  {RECOVERY[failure.kind].label}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <main className="workspace">
        <section className="list" aria-label="Dependencies">
          {tab === 'vulnerabilities' ? (
            <div className="scan-note">
              <span className="scan-text">
                {scanState}
                {model.advisoryData === undefined
                  ? ''
                  : ` Advisories ${model.advisoryData.stale ? 'may be stale' : `from ${ageOf(model.advisoryData.fetchedAt)}`}.`}
                {' '}
                Scan reachable contacts the Go vulnerability database.
              </span>
              <button
                type="button"
                className="button secondary compact"
                disabled={locked || targetManifests.length === 0}
                title="Run govulncheck through go run for the selected project"
                onClick={() => onScan(targetManifests)}
              >
                Scan reachable
              </button>
              <button
                type="button"
                className="link-button"
                disabled={locked}
                title="Scans already use the latest govulncheck through go run; install it only if you also want the CLI."
                onClick={onInstallScanner}
              >
                Install govulncheck
              </button>
            </div>
          ) : null}
          {tab === 'consolidate' ? (
            visible.length === 0 ? null : (
              <ConsolidateGroups
                groups={groupedDivergence(visible)}
                activeId={activeId}
                onSelect={setSelectedId}
              />
            )
          ) : (
          <table>
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all dependencies"
                    checked={allChecked}
                    onChange={toggleAll}
                  />
                </th>
                <SortHeader label="Module" column="module" sort={sort} onSort={toggleSort} />
                <SortHeader
                  label="Owning module"
                  column="owning"
                  sort={sort}
                  onSort={toggleSort}
                  className="col-owning"
                />
                <SortHeader
                  label="Required"
                  column="declared"
                  sort={sort}
                  onSort={toggleSort}
                  className="col-version col-required"
                />
                <SortHeader
                  label="Selected"
                  column="resolved"
                  sort={sort}
                  onSort={toggleSort}
                  className="col-version"
                />
                <SortHeader
                  label="Update"
                  column="update"
                  sort={sort}
                  onSort={toggleSort}
                  className="col-update"
                />
                <SortHeader
                  label="Type"
                  column="kind"
                  sort={sort}
                  onSort={toggleSort}
                  className="col-type"
                />
                <th scope="col" className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  selected={row.id === activeId}
                  checked={checked.has(row.id)}
                  unresolved={failedManifests.has(row.manifestPath)}
                  onSelect={() => setSelectedId(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
          )}
          {visible.length === 0 ? (
            <EmptyState
              tab={tab}
              query={query}
              hiddenByDirect={hiddenByDirect}
              onClearQuery={() => setQuery('')}
              onShowIndirect={() => setDirectOnly(false)}
            />
          ) : null}
        </section>

        <aside className="inspector" aria-label="Details">
          {selected ? (
            <Inspector
              key={selected.id}
              row={selected}
              versions={versions[selected.name]}
              versionsPending={versionsLoading[selected.name] === true}
              busy={locked}
              onVersions={onVersions}
              onUpdate={onUpdate}
              onOpenManifest={onOpenManifest}
              why={why[`${selected.manifestPath}#${selected.name}`]}
              onWhy={onWhy}
              releaseNotes={releaseNotes}
              onReleaseNotes={onReleaseNotes}
              preview={preview}
              onPreview={onPreview}
            />
          ) : (
            <p className="empty">Select a module.</p>
          )}
        </aside>
      </main>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  readonly label: string;
  readonly column: SortKey;
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
  readonly className?: string;
}): JSX.Element {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="sort-header" onClick={() => onSort(column)}>
        {label}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

function TabButton({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly tone?: 'warning' | 'danger';
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`tab${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
      {count > 0 ? <span className={`pill${tone === undefined ? '' : ` ${tone}`}`}>{count}</span> : null}
    </button>
  );
}

function Row({
  row,
  selected,
  checked,
  unresolved,
  onSelect,
  onToggle,
}: {
  readonly row: DependencyRow;
  readonly selected: boolean;
  readonly checked: boolean;
  readonly unresolved: boolean;
  readonly onSelect: () => void;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <tr className={selected ? 'selected' : undefined} onClick={onSelect}>
      <td className="col-check">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${row.name}`}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggle}
        />
      </td>
      <th scope="row" className="col-module">
        <div className="module-cell">
          <span className="mono path" title={row.name}>
            {row.name}
          </span>
          {row.transitive ? <span className="chip">indirect</span> : null}
          {row.advisories.length > 0 ? (
            <span
              className={`chip ${
                row.advisories.some((advisory) => advisory.reachable === true)
                  ? 'reachable'
                  : 'advisory'
              }`}
              title={row.advisories.map((advisory) => advisory.id).join(', ')}
            >
              {row.advisories.some((advisory) => advisory.reachable === true)
                ? 'reachable'
                : 'advisory'}
            </span>
          ) : null}
          {row.replacement === undefined ? null : (
            <span
              className="chip replaced"
              title={`Replaced by ${row.replacement.path}${
                row.replacement.version === undefined
                  ? ' (local directory)'
                  : ` ${row.replacement.version}`
              }`}
            >
              replaced
            </span>
          )}
        </div>
      </th>
      <td className="col-owning mono muted" title={row.project}>
        {row.project}
      </td>
      <td className="col-version col-required mono muted" title={row.declaredVersion}>
        {row.declaredVersion}
      </td>
      <td className="col-version mono muted" title={row.resolvedVersion ?? 'not resolved yet'}>
        {row.resolvedVersion === undefined ? (
          '—'
        ) : row.resolvedVersion === row.declaredVersion ? (
          row.resolvedVersion
        ) : (
          <>
            <span className="muted">{row.declaredVersion}</span>
            {' → '}
            {row.resolvedVersion}
          </>
        )}
      </td>
      <td className="col-update">
        {row.failure === undefined ? (
          <UpdateCell row={row} unresolved={unresolved} />
        ) : (
          <span className="row-error mono" title={row.failure}>
            {row.failure}
          </span>
        )}
      </td>
      <td className="col-type">
        {row.candidate === undefined ? null : (
          <span className={`badge kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span>
        )}
      </td>
      <td className="col-actions" onClick={(event) => event.stopPropagation()}>
        <details className="row-menu">
          <summary title="Module actions" aria-label={`Actions for ${row.name}`}>
            <MoreIcon />
          </summary>
          <div className="menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                void copyPath(row.name);
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              Copy module path
            </button>
            {pkgUrl(row) === undefined ? null : (
              <a
                role="menuitem"
                href={pkgUrl(row)}
                target="_blank"
                rel="noreferrer"
              >
                Open on pkg.go.dev
              </a>
            )}
          </div>
        </details>
      </td>
    </tr>
  );
}

function UpdateCell({
  row,
  unresolved,
}: {
  readonly row: DependencyRow;
  readonly unresolved: boolean;
}): JSX.Element {
  if (row.replacement !== undefined) {
    return <span className="muted mono">replaced</span>;
  }
  if (!row.candidate) {
    if (row.resolvedVersion === undefined) {
      return (
        <span className="muted mono">{unresolved ? '— unresolved' : '— not checked yet'}</span>
      );
    }
    return <span className="muted mono">— up to date</span>;
  }
  return <span className="mono candidate">{row.candidate}</span>;
}

function ConsolidateGroups({
  groups,
  activeId,
  onSelect,
}: {
  readonly groups: readonly { readonly name: string; readonly rows: readonly DependencyRow[] }[];
  readonly activeId: string | undefined;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div className="consolidate">
      {groups.map((group) => (
        <section key={group.name} className="consolidate-group">
          <h3 className="mono">{group.name}</h3>
          <ul>
            {group.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === activeId ? 'consolidate-row selected' : 'consolidate-row'}
                  onClick={() => onSelect(row.id)}
                >
                  <span className="mono">{row.project}</span>
                  <span className="mono candidate">{row.resolvedVersion}</span>
                  {row.declaredVersion === row.resolvedVersion ? null : (
                    <span className="muted">required {row.declaredVersion}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EmptyState({
  tab,
  query,
  hiddenByDirect,
  onClearQuery,
  onShowIndirect,
}: {
  readonly tab: Tab;
  readonly query: string;
  readonly hiddenByDirect: number;
  readonly onClearQuery: () => void;
  readonly onShowIndirect: () => void;
}): JSX.Element {
  if (query.trim() !== '') {
    return (
      <div className="empty empty-action">
        <p>Nothing matches “{query.trim()}”.</p>
        <button type="button" className="link-button" onClick={onClearQuery}>
          Clear filter
        </button>
      </div>
    );
  }

  if (hiddenByDirect > 0) {
    const noun =
      tab === 'updates'
        ? 'updates'
        : tab === 'vulnerabilities'
          ? 'advisories'
          : 'dependencies';
    return (
      <div className="empty empty-action">
        <p>
          {hiddenByDirect} {noun} hidden by <strong>Direct only</strong>.
        </p>
        <button type="button" className="link-button" onClick={onShowIndirect}>
          Show indirect too
        </button>
      </div>
    );
  }

  if (tab === 'vulnerabilities') {
    return (
      <p className="empty">
        No advisories matched the resolved versions. Reachability is not scanned yet.
      </p>
    );
  }
  if (tab === 'updates') {
    return <p className="empty">Everything is up to date.</p>;
  }
  if (tab === 'consolidate') {
    return (
      <p className="empty">Every module resolves the same version in every project.</p>
    );
  }
  return <p className="empty">No dependencies in this view.</p>;
}

function Inspector({
  row,
  versions,
  versionsPending,
  busy,
  onVersions,
  onUpdate,
  onOpenManifest,
  why,
  onWhy,
  releaseNotes,
  onReleaseNotes,
  preview,
  onPreview,
}: {
  readonly row: DependencyRow;
  readonly versions: readonly string[] | undefined;
  readonly versionsPending: boolean;
  readonly busy: boolean;
  readonly onVersions: (modulePath: string) => void;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
  readonly onOpenManifest: (manifestPath: string, name: string) => void;
  readonly why?: { readonly text?: string; readonly error?: string };
  readonly onWhy: (manifestPath: string, name: string) => void;
  readonly releaseNotes: Readonly<Record<string, ReleaseNotes | null>>;
  readonly onReleaseNotes: (modulePath: string, version: string) => void;
  readonly preview?: PreviewResult;
  readonly onPreview: (manifestPath: string, name: string, version: string) => void;
}): JSX.Element {
  const [includePrereleases, setIncludePrereleases] = useState(false);

  useEffect(() => {
    if (row.replacement === undefined) {
      onVersions(row.name);
    }
    onWhy(row.manifestPath, row.name);
  }, [row.name, row.manifestPath, row.replacement]);

  const known = [row.candidate, row.resolvedVersion, row.declaredVersion].filter(isString);
  const options = pickerVersions(
    [...new Set([...(versions ?? []), ...known])].sort((left, right) =>
      compareVersions(right, left),
    ),
    { includePrereleases },
  );
  const fallback = options[0] ?? row.declaredVersion;
  const [version, setVersion] = useState(fallback);
  const chosen = options.includes(version) ? version : fallback;
  const matchingPreview =
    preview !== undefined &&
    preview.manifestPath === row.manifestPath &&
    preview.name === row.name &&
    preview.version === chosen
      ? preview
      : undefined;
  const apply = versionApplyOffer(row.resolvedVersion, chosen, {
    includePrereleases,
    allowDowngrade: matchingPreview?.status === 'ready',
  });
  const needsPreview =
    row.resolvedVersion !== undefined && compareVersions(chosen, row.resolvedVersion) < 0;
  const notes = releaseNotes[`${row.name}@${chosen}`];

  useEffect(() => {
    if (row.name.startsWith('github.com/')) {
      onReleaseNotes(row.name, chosen);
    }
  }, [row.name, chosen]);

  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <div>
          <h2 className="mono">
            {row.name}
            {row.transitive ? <span className="chip">indirect</span> : null}
          </h2>
          <p className="muted">
            required by <span className="mono">{row.project}</span>
          </p>
        </div>
        {pkgUrl(row) === undefined ? null : (
          <a
            className="icon-button"
            href={pkgUrl(row)}
            target="_blank"
            rel="noreferrer"
            title="Open on pkg.go.dev"
          >
            <ExternalLinkIcon />
          </a>
        )}
      </header>

      <dl className="facts">
        <div>
          <dt>Owning module</dt>
          <dd className="mono">{row.project}</dd>
        </div>
        <div>
          <dt>Declared in</dt>
          <dd>
            <button
              type="button"
              className="link-button path-link"
              title="Open go.mod at this require"
              onClick={() => onOpenManifest(row.manifestPath, row.name)}
            >
              {row.manifestPath}
            </button>
          </dd>
        </div>
        <div>
          <dt>Required</dt>
          <dd className="mono">{row.declaredVersion}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd className="mono">{row.resolvedVersion ?? '—'}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd className={row.candidate ? 'mono candidate' : 'mono muted'}>
            {row.replacement === undefined
              ? (row.candidate ?? 'none on this path')
              : 'managed by replace'}
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd className="muted">{row.transitive ? 'indirect dependency' : 'direct dependency'}</dd>
        </div>
        <div className="why-row">
          <dt>Why</dt>
          <dd>
            <pre className="why-text">
              {why?.error ?? why?.text ?? 'Looking up go mod why…'}
            </pre>
          </dd>
        </div>
        {row.replacement === undefined ? null : (
          <div>
            <dt>Replaced by</dt>
            <dd className="mono">
              {pkgUrl(row) === undefined ? (
                <span>
                  {row.replacement.path} (local directory)
                </span>
              ) : (
                <a href={pkgUrl(row)} target="_blank" rel="noreferrer">
                  {row.replacement.path}
                  {row.replacement.version === undefined
                    ? ''
                    : ` ${row.replacement.version}`}
                </a>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>Links</dt>
          <dd className="links">
            {pkgUrl(row) === undefined ? (
              <span className="muted">local replacement</span>
            ) : (
              <a href={pkgUrl(row)} target="_blank" rel="noreferrer">
                pkg.go.dev
              </a>
            )}
            {repositoryUrlFor(row) === undefined ? null : (
              <>
                {' · '}
                <a href={repositoryUrlFor(row)} target="_blank" rel="noreferrer">
                  repository
                </a>
              </>
            )}
          </dd>
        </div>
      </dl>

      {row.name.startsWith('github.com/') ? (
        notes === undefined ? (
          <p className="muted version-note">Looking up release notes…</p>
        ) : notes === null ? (
          <p className="muted version-note">No release notes for this version.</p>
        ) : (
          <div className="release-notes">
            <strong>{notes.title}</strong>
            {notes.body === '' ? null : <pre className="why-text">{notes.body}</pre>}
            <a href={notes.url} target="_blank" rel="noreferrer">
              Open release
            </a>
          </div>
        )
      ) : null}

      {row.replacement === undefined ? (
        <>
          <div className="controls">
            <Dropdown
              label="Version"
              value={chosen}
              options={options.map((candidate) => ({
                value: candidate,
                label: candidate,
              }))}
              onChange={setVersion}
              disabled={busy}
              grow
            />
            {needsPreview && matchingPreview?.status !== 'ready' ? (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                title={`Preview go get ${row.name}@${chosen}`}
                onClick={() => onPreview(row.manifestPath, row.name, chosen)}
              >
                Preview impact
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={busy || !apply.allowed}
                title={
                  apply.allowed
                    ? `Run go get ${row.name}@${chosen}`
                    : apply.reason
                }
                onClick={() => onUpdate(row.manifestPath, row.name, chosen)}
              >
                {needsPreview ? 'Confirm downgrade' : 'Update'}
              </button>
            )}
          </div>
          <label className="checkbox version-prerelease">
            <input
              type="checkbox"
              checked={includePrereleases}
              disabled={busy}
              onChange={(event) => setIncludePrereleases(event.target.checked)}
            />
            Show prereleases
          </label>
          {matchingPreview?.status === 'ready' && matchingPreview.impact.length > 0 ? (
            <ul className="impact">
              {matchingPreview.impact.map((entry) => (
                <li key={entry.name} className="mono">
                  {entry.kind === 'removed'
                    ? `drops ${entry.name} ${entry.from ?? ''}`
                    : `${entry.kind} ${entry.name} ${entry.from ?? ''} → ${entry.to ?? ''}`}
                </li>
              ))}
            </ul>
          ) : null}
          {matchingPreview?.status === 'failed' ? (
            <p className="version-note muted">{matchingPreview.message}</p>
          ) : null}
          {apply.allowed || chosen === row.resolvedVersion || needsPreview ? null : (
            <p className="version-note muted">{apply.reason}</p>
          )}

          {versionsPending ? (
            <p className="version-note muted">
              <span className="spinner" aria-hidden="true" /> Loading all versions…
            </p>
          ) : null}
        </>
      ) : (
        <p className="replace-note">
          Version controlled by the replace directive. GMM leaves it untouched; edit{' '}
          <code className="mono">go.mod</code> to change it.
        </p>
      )}

      {row.advisoryUnchecked === true ? (
        <p className="unchecked-note mono">
          Advisory lookup skipped: this module path is private.
        </p>
      ) : null}

      {row.advisories.map((advisory) => (
        <AdvisoryCard
          key={advisory.id}
          advisory={advisory}
          row={row}
          busy={busy}
          onUpdate={onUpdate}
        />
      ))}

      {row.replacement === undefined ? (
        <p className="footnote mono">
          Runs <code>go get</code> in {row.project} with workspace mode off.
        </p>
      ) : null}
    </div>
  );
}

function AdvisoryCard({
  advisory,
  row,
  busy,
  onUpdate,
}: {
  readonly advisory: Advisory;
  readonly row: DependencyRow;
  readonly busy: boolean;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
}): JSX.Element {
  const fix = advisoryFixOffer(advisory, row.resolvedVersion);
  const reason = fix.offered ? undefined : fix.reason;

  return (
    <div className={advisory.reachable === true ? 'callout reachable' : 'callout'}>
      <WarningIcon size={16} />
      <div>
        <strong>Advisory affects this module</strong>
        <p className="mono">
          {advisory.id} · {advisory.summary}
          {` · ${affectedRangeText(advisory)}`}
          {advisory.fixedIn ? ` · fixed in ${advisory.fixedIn}` : ''}
        </p>
        {advisory.reachable === true ? (
          <p className="reachable-line mono">
            Reachable via {advisory.symbol ?? 'an unnamed symbol'}
            {advisory.packagePath === undefined ? '' : ` · ${advisory.packagePath}`}
          </p>
        ) : null}
        <div className="callout-actions">
          <a
            href={`https://pkg.go.dev/vuln/${advisory.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open advisory <ArrowRightIcon />
          </a>
          {fix.offered && row.replacement === undefined ? (
            <button
              type="button"
              className="button primary compact"
              disabled={busy}
              title={`Run go get ${row.name}@${fix.version}`}
              onClick={() => onUpdate(row.manifestPath, row.name, fix.version)}
            >
              Update to {fix.version}
            </button>
          ) : (
            <span className="muted callout-reason">
              {row.replacement === undefined
                ? (reason ?? 'No update is available for this advisory.')
                : 'Replaced module: update the replacement instead.'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    // The webview clipboard needs focus; failing silently beats a broken row.
  }
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function repositoryUrl(modulePath: string): string | undefined {
  const match = /^(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+)\/([^/]+)/.exec(
    modulePath,
  );
  if (match === null) {
    return undefined;
  }
  return `https://${match[1]}/${match[2]}/${match[3]}`;
}

/** The module whose code actually runs: the replace target, or the declared path. */
function linkModulePath(row: DependencyRow): string | undefined {
  if (row.replacement === undefined) {
    return row.name;
  }
  return row.replacement.version === undefined ? undefined : row.replacement.path;
}

function pkgUrl(row: DependencyRow): string | undefined {
  const path = linkModulePath(row);
  return path === undefined ? undefined : `https://pkg.go.dev/${path}`;
}

function repositoryUrlFor(row: DependencyRow): string | undefined {
  const path = linkModulePath(row);
  return path === undefined ? undefined : repositoryUrl(path);
}

function ageOf(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) {
    return 'an unknown time ago';
  }
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}
