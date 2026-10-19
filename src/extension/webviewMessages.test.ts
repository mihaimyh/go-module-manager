import { describe, expect, it } from 'vitest';
import type { PanelModel } from '../core/model';
import type { PanelHandlers } from './handlers';
import { handleWebviewMessage } from './webviewMessages';

const SAMPLE_MODEL: PanelModel = {
  projects: [
    { name: 'example.com/a', manifestPath: '/repo/a/go.mod', dependencyCount: 1 },
    { name: 'example.com/b', manifestPath: '/repo/b/go.mod', dependencyCount: 0 },
  ],
  rows: [
    {
      id: '/repo/a/go.mod#rsc.io/quote',
      name: 'rsc.io/quote',
      project: 'example.com/a',
      manifestPath: '/repo/a/go.mod',
      declaredVersion: 'v1.5.1',
      resolvedVersion: 'v1.5.1',
      transitive: false,
      kind: 'none',
      advisories: [],
    },
  ],
};

function createRecorder() {
  const calls: { kind: string; args: readonly unknown[] }[] = [];
  const handlers: PanelHandlers = {
    onRefresh: () => calls.push({ kind: 'refresh', args: [] }),
    onRecover: (manifestPath, action) =>
      calls.push({ kind: 'recover', args: [manifestPath, action] }),
    onUpdate: (request) => calls.push({ kind: 'update', args: [request] }),
    onApplyTargets: (targets) => calls.push({ kind: 'apply-targets', args: [targets] }),
    onBulkUpdate: (selection) => calls.push({ kind: 'bulk-update', args: [selection] }),
    onTidy: (manifests) => calls.push({ kind: 'tidy', args: [manifests] }),
    onScan: (manifests) => calls.push({ kind: 'scan', args: [manifests] }),
    onInstallScanner: () => calls.push({ kind: 'install-scanner', args: [] }),
    onVersions: (modulePath) => calls.push({ kind: 'versions', args: [modulePath] }),
    onOpenPanel: () => calls.push({ kind: 'open-panel', args: [] }),
    onOpenManifest: (manifestPath, name) =>
      calls.push({ kind: 'open-manifest', args: [manifestPath, name] }),
    onUninstall: (targets) => calls.push({ kind: 'uninstall', args: [targets] }),
    onShowOutput: () => calls.push({ kind: 'show-output', args: [] }),
    onWhy: (manifestPath, name) => calls.push({ kind: 'why', args: [manifestPath, name] }),
    onReleaseNotes: (modulePath, version) =>
      calls.push({ kind: 'release-notes', args: [modulePath, version] }),
    onPreview: (manifestPath, name, version) =>
      calls.push({ kind: 'preview', args: [manifestPath, name, version] }),
    onSearch: (query, pageToken) =>
      calls.push({ kind: 'search', args: [query, pageToken] }),
    onModuleMetadata: (modulePath, version) =>
      calls.push({ kind: 'module-metadata', args: [modulePath, version] }),
  };
  return { calls, handlers };
}

describe('handleWebviewMessage', () => {
  it('forwards search and module-metadata messages for uninstalled Browse modules', () => {
    const { calls, handlers } = createRecorder();
    handleWebviewMessage(
      { type: 'search', query: 'cobra', pageToken: 'next-1' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'module-metadata', modulePath: 'github.com/spf13/cobra', version: 'v1.10.2' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'versions', modulePath: 'github.com/spf13/cobra' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );

    expect(calls).toEqual([
      { kind: 'search', args: ['cobra', 'next-1'] },
      { kind: 'module-metadata', args: ['github.com/spf13/cobra', 'v1.10.2'] },
      { kind: 'versions', args: ['github.com/spf13/cobra'] },
    ]);
  });

  it('allows adding a brand-new module or applying multi-project targets only to known workspace projects', () => {
    const { calls, handlers } = createRecorder();
    handleWebviewMessage(
      {
        type: 'update',
        manifestPath: '/repo/b/go.mod',
        name: 'github.com/spf13/cobra',
        version: 'v1.10.2',
      },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      {
        type: 'apply-targets',
        targets: [
          { manifestPath: '/repo/a/go.mod', name: 'github.com/spf13/cobra', version: 'v1.10.2' },
          { manifestPath: '/outside/go.mod', name: 'github.com/spf13/cobra', version: 'v1.10.2' },
        ],
      },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );

    expect(calls).toEqual([
      {
        kind: 'update',
        args: [
          {
            manifestPath: '/repo/b/go.mod',
            changes: [{ name: 'github.com/spf13/cobra', version: 'v1.10.2' }],
          },
        ],
      },
      {
        kind: 'apply-targets',
        args: [
          [{ manifestPath: '/repo/a/go.mod', name: 'github.com/spf13/cobra', version: 'v1.10.2' }],
        ],
      },
    ]);
  });

  it('routes uninstall for known rows, show-output, and manifest-level open-manifest', () => {
    const { calls, handlers } = createRecorder();
    handleWebviewMessage(
      {
        type: 'uninstall',
        targets: [
          { manifestPath: '/repo/a/go.mod', name: 'rsc.io/quote' },
          { manifestPath: '/repo/b/go.mod', name: 'rsc.io/quote' },
        ],
      },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'show-output' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'open-manifest', manifestPath: '/repo/b/go.mod' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'open-manifest', manifestPath: '/repo/b/go.mod', name: 'rsc.io/quote' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'open-manifest', manifestPath: '/repo/a/go.mod', name: 'rsc.io/quote' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );
    handleWebviewMessage(
      { type: 'open-manifest', manifestPath: '/outside/go.mod' },
      { getModel: () => SAMPLE_MODEL, handlers, postModel: () => {} },
    );

    expect(calls).toEqual([
      {
        kind: 'uninstall',
        args: [[{ manifestPath: '/repo/a/go.mod', name: 'rsc.io/quote' }]],
      },
      { kind: 'show-output', args: [] },
      { kind: 'open-manifest', args: ['/repo/b/go.mod', undefined] },
      { kind: 'open-manifest', args: ['/repo/b/go.mod', undefined] },
      { kind: 'open-manifest', args: ['/repo/a/go.mod', 'rsc.io/quote'] },
    ]);
  });
});

