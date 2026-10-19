import { useMemo, useState } from 'react';
import type { DependencyRow, PanelModel } from '../core/model';
import type { UpdateKind } from '../core/version';

const KIND_LABELS: Record<UpdateKind, string> = {
  none: 'up to date',
  patch: 'patch',
  minor: 'minor',
  major: 'major',
  prerelease: 'prerelease',
  release: 'release',
};

interface AppProps {
  readonly model: PanelModel | undefined;
}

export function App({ model }: AppProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [directOnly, setDirectOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();

  const rows = model?.rows ?? [];
  const modules = model?.modules ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (directOnly && row.indirect) {
        return false;
      }
      if (moduleFilter !== 'all' && row.owningModule !== moduleFilter) {
        return false;
      }
      return needle === '' || row.path.toLowerCase().includes(needle);
    });
  }, [rows, query, moduleFilter, directOnly]);

  const selected = rows.find((row) => row.id === selectedId);

  if (!model) {
    return <p className="empty">Reading the workspace…</p>;
  }

  return (
    <main className="app">
      <header className="toolbar">
        <h1>Go modules</h1>
        <span className="count">
          {filtered.length} of {rows.length}
        </span>
        <input
          className="search"
          type="search"
          placeholder="Filter by module path"
          aria-label="Filter by module path"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {modules.length > 1 ? (
          <select
            aria-label="Owning module"
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
          >
            <option value="all">All modules ({modules.length})</option>
            {modules.map((module) => (
              <option key={module.goModPath} value={module.path}>
                {module.path} ({module.dependencyCount})
              </option>
            ))}
          </select>
        ) : null}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={directOnly}
            onChange={(event) => setDirectOnly(event.target.checked)}
          />
          Direct only
        </label>
      </header>

      <div className="layout">
        <section className="list" aria-label="Dependencies">
          <table>
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Owning module</th>
                <th scope="col">Version</th>
                <th scope="col">Update</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? 'selected' : undefined}
                >
                  <th scope="row">
                    <button type="button" onClick={() => setSelectedId(row.id)}>
                      {row.path}
                    </button>
                    {row.indirect ? <span className="tag">indirect</span> : null}
                  </th>
                  <td className="muted">{row.owningModule}</td>
                  <td>
                    {row.requiredVersion === row.selectedVersion ? (
                      row.selectedVersion
                    ) : (
                      <>
                        <span className="muted">{row.requiredVersion}</span>
                        {' → '}
                        {row.selectedVersion}
                      </>
                    )}
                  </td>
                  <td>
                    <Candidate row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="empty">Nothing matches those filters.</p>
          ) : null}
        </section>

        <aside className="details" aria-label="Details">
          {selected ? <Details row={selected} /> : <p className="empty">Select a module.</p>}
        </aside>
      </div>
    </main>
  );
}

function Candidate({ row }: { readonly row: DependencyRow }): JSX.Element {
  if (!row.candidate) {
    return <span className="muted">—</span>;
  }
  return (
    <span className={`badge kind-${row.kind}`}>
      {row.candidate} · {KIND_LABELS[row.kind]}
    </span>
  );
}

function Details({ row }: { readonly row: DependencyRow }): JSX.Element {
  return (
    <div className="details-body">
      <h2>{row.path}</h2>
      <dl>
        <dt>Owning module</dt>
        <dd>{row.owningModule}</dd>
        <dt>Declared in</dt>
        <dd className="path">{row.goModPath}</dd>
        <dt>Required</dt>
        <dd>{row.requiredVersion}</dd>
        <dt>Selected</dt>
        <dd>{row.selectedVersion}</dd>
        <dt>Candidate</dt>
        <dd>{row.candidate ?? 'none on this path'}</dd>
        <dt>Kind</dt>
        <dd>{KIND_LABELS[row.kind]}</dd>
        <dt>Type</dt>
        <dd>{row.indirect ? 'indirect' : 'direct'}</dd>
      </dl>
      <p className="note">
        Updates here are not wired yet. Every action will run in the owning module with
        workspace mode off.
      </p>
    </div>
  );
}
