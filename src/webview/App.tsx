import { useMemo, useState } from 'react';
import type { Advisory, DependencyRow, PanelModel } from '../core/model';
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

type Tab = 'dependencies' | 'updates' | 'vulnerabilities';

interface AppProps {
  readonly model: PanelModel | undefined;
}

export function App({ model }: AppProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('dependencies');
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [directOnly, setDirectOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  const rows = model?.rows ?? [];
  const modules = model?.modules ?? [];
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
      if (directOnly && row.indirect) {
        return false;
      }
      if (moduleFilter !== 'all' && row.owningModule !== moduleFilter) {
        return false;
      }
      return needle === '' || row.path.toLowerCase().includes(needle);
    });
  }, [rows, updates, tab, query, moduleFilter, directOnly]);

  // Open on the row that needs attention: an advisory first, then an update.
  const activeId =
    selectedId ??
    rows.find((row) => row.advisories.length > 0)?.id ??
    rows.find((row) => row.candidate !== undefined)?.id ??
    rows[0]?.id;
  const selected = rows.find((row) => row.id === activeId);

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
          {modules.length > 1 ? (
            <div className="select">
              <select
                aria-label="Owning module"
                value={moduleFilter}
                onChange={(event) => setModuleFilter(event.target.value)}
              >
                <option value="all">All modules ({modules.length})</option>
                {modules.map((module) => (
                  <option key={module.goModPath} value={module.path}>
                    {module.path}
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
            disabled
            title="Wires up with the go runner in the next step"
          >
            <TerminalIcon />
            go mod tidy
          </button>
          <button
            type="button"
            className="button primary"
            disabled
            title="Wires up with the go runner in the next step"
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
          tone="warning"
          active={tab === 'vulnerabilities'}
          onClick={() => setTab('vulnerabilities')}
        />
        <button type="button" className="tab disabled" disabled title="Lands in 1.0">
          Consolidate
        </button>
        {checked.size > 0 ? (
          <span className="selection-count">{checked.size} selected</span>
        ) : null}
      </nav>

      <main className="workspace">
        <section className="list" aria-label="Dependencies">
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
                  onSelect={() => setSelectedId(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? <EmptyState tab={tab} /> : null}
        </section>

        <aside className="inspector" aria-label="Details">
          {selected ? <Inspector row={selected} /> : <p className="empty">Select a module.</p>}
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
  readonly tone?: 'warning';
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
      {count > 0 ? <span className={`pill${tone === 'warning' ? ' warning' : ''}`}>{count}</span> : null}
    </button>
  );
}

function Row({
  row,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  readonly row: DependencyRow;
  readonly selected: boolean;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <tr className={selected ? 'selected' : undefined} onClick={onSelect}>
      <td className="col-check">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${row.path}`}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggle}
        />
      </td>
      <th scope="row" className="col-module">
        <span className="mono path" title={row.path}>
          {row.path}
        </span>
        {row.indirect ? <span className="chip">indirect</span> : null}
      </th>
      <td className="col-owning mono muted" title={row.owningModule}>
        {row.owningModule}
      </td>
      <td className="col-version mono muted" title={row.requiredVersion}>
        {row.requiredVersion}
      </td>
      <td className="col-version mono muted" title={row.selectedVersion}>
        {row.selectedVersion}
      </td>
      <td className="col-update">
        <Candidate row={row} />
      </td>
      <td className="col-actions" onClick={(event) => event.stopPropagation()}>
        <details className="row-menu">
          <summary title="Module actions" aria-label={`Actions for ${row.path}`}>
            <MoreIcon />
          </summary>
          <div className="menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                void copyPath(row.path);
                event.currentTarget.closest('details')?.removeAttribute('open');
              }}
            >
              Copy module path
            </button>
            <a
              role="menuitem"
              href={`https://pkg.go.dev/${row.path}`}
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

function Candidate({ row }: { readonly row: DependencyRow }): JSX.Element {
  if (!row.candidate) {
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
        No advisory data yet. Module-level badges arrive with the advisory cache; reachable
        findings arrive with the precise scan.
      </p>
    );
  }
  return <p className="empty">Nothing matches those filters.</p>;
}

function Inspector({ row }: { readonly row: DependencyRow }): JSX.Element {
  const versions = Array.from(
    new Set([row.candidate, row.selectedVersion, row.requiredVersion].filter(isString)),
  );

  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <div>
          <h2 className="mono">
            {row.path}
            {row.indirect ? <span className="chip">indirect</span> : null}
          </h2>
          <p className="muted">
            required by <span className="mono">{row.owningModule}</span>
          </p>
        </div>
        <a
          className="icon-button"
          href={`https://pkg.go.dev/${row.path}`}
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
          <dd className="mono">{row.owningModule}</dd>
        </div>
        <div>
          <dt>Declared in</dt>
          <dd>
            <code className="mono path-code">{row.goModPath}</code>
          </dd>
        </div>
        <div>
          <dt>Required</dt>
          <dd className="mono">{row.requiredVersion}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd className="mono">{row.selectedVersion}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd className={row.candidate ? 'mono candidate' : 'mono muted'}>
            {row.candidate ?? 'none on this path'}
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd className="muted">{row.indirect ? 'indirect dependency' : 'direct dependency'}</dd>
        </div>
      </dl>

      <div className="controls">
        <div className="select grow">
          <select key={row.id} aria-label="Version to install" defaultValue={versions[0]}>
            {versions.map((version) => (
              <option key={version} value={version}>
                {version}
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
          disabled
          title="Update engine lands in the next step"
        >
          Update
        </button>
      </div>

      {row.advisories.map((advisory) => (
        <AdvisoryCard key={advisory.id} advisory={advisory} />
      ))}

      <p className="footnote mono">
        Runs <code>go get</code> in {row.owningModule} with workspace mode off.
      </p>
    </div>
  );
}

function AdvisoryCard({ advisory }: { readonly advisory: Advisory }): JSX.Element {
  return (
    <div className="callout">
      <WarningIcon size={16} />
      <div>
        <strong>Advisory affects this module</strong>
        <p className="mono">
          {advisory.id} · {advisory.summary}
          {advisory.fixedIn ? ` · fixed in ${advisory.fixedIn}` : ''}
        </p>
        <a
          href={`https://pkg.go.dev/vuln/${advisory.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Open advisory <ArrowRightIcon />
        </a>
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
