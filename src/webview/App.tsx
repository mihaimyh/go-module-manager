import { useEffect, useMemo, useState } from 'react';
import type { DependencySelection, RecoveryAction, ResolveProgress } from '../core/messages';
import { advisoryFixOffer } from '../core/advisoryAction';
import { hasReachable } from '../core/scan';
import type { Advisory, DependencyRow, FailureKind, PanelModel } from '../core/model';
import type { UpdateKind } from '../core/version';
import {
  ArrowRightIcon,
  ChevronIcon,
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
  verification: { action: 'retry', label: 'Retry' },
  timeout: { action: 'retry', label: 'Retry' },
  unknown: { action: 'retry', label: 'Retry' },
};

type Tab = 'dependencies' | 'updates' | 'vulnerabilities';

interface AppProps {
  readonly model: PanelModel | undefined;
  readonly progress?: ResolveProgress;
  readonly clearSignal?: number;
  readonly onRefresh: () => void;
  readonly onRecover: (manifestPath: string, action: RecoveryAction) => void;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
  readonly onBulkUpdate: (selection: readonly DependencySelection[]) => void;
  readonly onTidy: (manifests: readonly string[]) => void;
  readonly onScan: (manifests: readonly string[]) => void;
  readonly onInstallScanner: () => void;
}

export function App({
  model,
  progress,
  clearSignal,
  onRefresh,
  onRecover,
  onUpdate,
  onBulkUpdate,
  onTidy,
  onScan,
  onInstallScanner,
}: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash === '#vulnerabilities' ? 'vulnerabilities' : 'dependencies',
  );
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [directOnly, setDirectOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

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
  const advisoryIds = new Set(rows.flatMap((row) => row.advisories.map((a) => a.id)));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byTab =
      tab === 'updates'
        ? updates
        : tab === 'vulnerabilities'
          ? rows.filter((row) => row.advisories.length > 0)
          : rows;

    return byTab.filter((row) => {
      if (directOnly && row.transitive) {
        return false;
      }
      if (moduleFilter !== 'all' && row.project !== moduleFilter) {
        return false;
      }
      return needle === '' || row.name.toLowerCase().includes(needle);
    });
  }, [rows, updates, tab, query, moduleFilter, directOnly]);

  // Open on the row that needs attention: an advisory first, then an update.
  const activeId =
    selectedId ??
    rows.find((row) => row.advisories.length > 0)?.id ??
    rows.find((row) => row.candidate !== undefined)?.id ??
    rows[0]?.id;
  const selected = rows.find((row) => row.id === activeId);
  const selectedRows = rows.filter((row) => checked.has(row.id));
  const updatable = selectedRows.filter((row) => row.candidate !== undefined);
  const targetManifests = (() => {
    if (selectedRows.length > 0) {
      return [...new Set(selectedRows.map((row) => row.manifestPath))];
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
      ? 'Reachability has not been scanned.'
      : `Reachable code scanned ${ageOf(at)}.`;
  })();

  if (!model) {
    return <p className="empty">Reading the workspace…</p>;
  }

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
            {visible.length} of {rows.length}
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
            <div className="select">
              <select
                aria-label="Owning module"
                value={moduleFilter}
                onChange={(event) => setModuleFilter(event.target.value)}
              >
                <option value="all">All modules ({projects.length})</option>
                {projects.map((project) => (
                  <option key={project.manifestPath} value={project.name}>
                    {project.name}
                  </option>
                ))}
              </select>
              <span className="select-icon" aria-hidden="true">
                <ChevronIcon />
              </span>
            </div>
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
          <button
            type="button"
            className="button secondary"
            onClick={() => onTidy(targetManifests)}
            title="Run go mod tidy in the selected projects"
          >
            <TerminalIcon />
            go mod tidy
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onRefresh}
            title="Re-run the update lookup"
          >
            <RefreshIcon />
            Check for updates
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Views">
        <TabButton
          label="Dependencies"
          count={rows.length}
          active={tab === 'dependencies'}
          onClick={() => setTab('dependencies')}
        />
        <TabButton
          label="Updates"
          count={updates.length}
          active={tab === 'updates'}
          onClick={() => setTab('updates')}
        />
        <TabButton
          label="Vulnerabilities"
          count={advisoryIds.size}
          tone={reachable ? 'danger' : 'warning'}
          active={tab === 'vulnerabilities'}
          onClick={() => setTab('vulnerabilities')}
        />
        <button type="button" className="tab disabled" disabled title="Lands in 1.0">
          Consolidate
        </button>
        {progress !== undefined && progress.done < progress.total ? (
          <span className="selection-count">
            checking {progress.done}/{progress.total}
          </span>
        ) : null}
        {checked.size > 0 ? (
          <span className="selection-count">{checked.size} selected</span>
        ) : null}
        {checked.size > 0 ? (
          <button
            type="button"
            className="button primary compact"
            disabled={updatable.length === 0}
            title={
              updatable.length === 0
                ? 'Nothing in this selection has an update'
                : `Update ${updatable.length} dependencies${
                    checked.size - updatable.length > 0
                      ? `; ${checked.size - updatable.length} selected have no update`
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
              </span>
              <button
                type="button"
                className="button secondary compact"
                disabled={targetManifests.length === 0}
                title="Run govulncheck through go run for the selected project"
                onClick={() => onScan(targetManifests)}
              >
                Scan reachable
              </button>
              <button
                type="button"
                className="link-button"
                title="Scans already use the latest govulncheck through go run; install it only if you also want the CLI."
                onClick={onInstallScanner}
              >
                Install govulncheck
              </button>
            </div>
          ) : null}
          <table>
            <colgroup>
              <col className="col-check" />
              <col />
              <col className="col-owning" />
              <col className="col-version" />
              <col className="col-version" />
              <col className="col-update" />
              <col className="col-actions" />
            </colgroup>
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
                <th scope="col">Module</th>
                <th scope="col">Owning module</th>
                <th scope="col">Required</th>
                <th scope="col">Selected</th>
                <th scope="col">Update</th>
                <th scope="col" className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
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
          {visible.length === 0 ? <EmptyState tab={tab} /> : null}
        </section>

        <aside className="inspector" aria-label="Details">
          {selected ? (
            <Inspector key={selected.id} row={selected} onUpdate={onUpdate} />
          ) : (
            <p className="empty">Select a module.</p>
          )}
        </aside>
      </main>
    </div>
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
      </th>
      <td className="col-owning mono muted" title={row.project}>
        {row.project}
      </td>
      <td className="col-version mono muted" title={row.declaredVersion}>
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
          <Candidate row={row} unresolved={unresolved} />
        ) : (
          <span className="row-error mono" title={row.failure}>
            {row.failure}
          </span>
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
            <a
              role="menuitem"
              href={`https://pkg.go.dev/${row.name}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on pkg.go.dev
            </a>
          </div>
        </details>
      </td>
    </tr>
  );
}

function Candidate({
  row,
  unresolved,
}: {
  readonly row: DependencyRow;
  readonly unresolved: boolean;
}): JSX.Element {
  if (!row.candidate) {
    if (row.resolvedVersion === undefined) {
      return (
        <span className="muted mono">{unresolved ? '— unresolved' : '— not checked yet'}</span>
      );
    }
    return <span className="muted mono">— up to date</span>;
  }
  return (
    <>
      <span className="mono candidate">{row.candidate}</span>
      <span className={`badge kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span>
    </>
  );
}

function EmptyState({ tab }: { readonly tab: Tab }): JSX.Element {
  if (tab === 'vulnerabilities') {
    return (
      <p className="empty">
        No advisories matched the resolved versions. Reachability scanning is a later
        ticket.
      </p>
    );
  }
  return <p className="empty">Nothing matches those filters.</p>;
}

function Inspector({
  row,
  onUpdate,
}: {
  readonly row: DependencyRow;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
}): JSX.Element {
  const versions = Array.from(
    new Set([row.candidate, row.resolvedVersion, row.declaredVersion].filter(isString)),
  );
  const [version, setVersion] = useState(versions[0]);

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
        <a
          className="icon-button"
          href={`https://pkg.go.dev/${row.name}`}
          target="_blank"
          rel="noreferrer"
          title="Open on pkg.go.dev"
        >
          <ExternalLinkIcon />
        </a>
      </header>

      <dl className="facts">
        <div>
          <dt>Owning module</dt>
          <dd className="mono">{row.project}</dd>
        </div>
        <div>
          <dt>Declared in</dt>
          <dd>
            <code className="mono path-code">{row.manifestPath}</code>
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
            {row.candidate ?? 'none on this path'}
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd className="muted">{row.transitive ? 'indirect dependency' : 'direct dependency'}</dd>
        </div>
      </dl>

      <div className="controls">
        <div className="select grow">
          <select
            aria-label="Version to install"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          >
            {versions.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
          <span className="select-icon" aria-hidden="true">
            <ChevronIcon />
          </span>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={version === row.resolvedVersion}
          title={
            version === row.resolvedVersion
              ? 'Already resolved at this version'
              : `Run go get ${row.name}@${version}`
          }
          onClick={() => onUpdate(row.manifestPath, row.name, version)}
        >
          Update
        </button>
      </div>

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
          onUpdate={onUpdate}
        />
      ))}

      <p className="footnote mono">
        Runs <code>go get</code> in {row.project} with workspace mode off.
      </p>
    </div>
  );
}

function AdvisoryCard({
  advisory,
  row,
  onUpdate,
}: {
  readonly advisory: Advisory;
  readonly row: DependencyRow;
  readonly onUpdate: (manifestPath: string, name: string, version: string) => void;
}): JSX.Element {
  const fix = advisoryFixOffer(advisory, row.resolvedVersion);

  return (
    <div className={advisory.reachable === true ? 'callout reachable' : 'callout'}>
      <WarningIcon size={16} />
      <div>
        <strong>Advisory affects this module</strong>
        <p className="mono">
          {advisory.id} · {advisory.summary}
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
          {fix.offered ? (
            <button
              type="button"
              className="button primary compact"
              title={`Run go get ${row.name}@${fix.version}`}
              onClick={() => onUpdate(row.manifestPath, row.name, fix.version)}
            >
              Update to {fix.version}
            </button>
          ) : (
            <span className="muted callout-reason">{fix.reason}</span>
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
