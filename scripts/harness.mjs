import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/model-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/model-entry.cjs',
  logLevel: 'silent',
});

const model = execFileSync(process.execPath, ['dist/model-entry.cjs'], { encoding: 'utf8' });

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>GMM webview harness</title>
    <link rel="stylesheet" href="./webview.css" />
    <style>html, body { height: 100%; margin: 0; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__payload = ${model};
      window.acquireVsCodeApi = function () {
        return {
          postMessage: function (message) {
            if (message && message.type === 'ready') {
              setTimeout(function () {
                window.postMessage(
                  {
                    type: 'model',
                    model: window.__payload.model,
                    progress: window.__payload.progress,
                  },
                  '*',
                );
              }, 0);
            } else if (message && message.type === 'search') {
              setTimeout(function () {
                window.postMessage(
                  {
                    type: 'search-results',
                    query: message.query || '',
                    append: Boolean(message.pageToken),
                    results: [
                      {
                        modulePath: 'github.com/spf13/cobra',
                        latestVersion: 'v1.8.1',
                        synopsis: 'Package cobra is a commander providing a simple interface to create powerful modern CLI interfaces.',
                        importedByCount: 158420,
                      },
                      {
                        modulePath: 'golang.org/x/sync',
                        latestVersion: 'v0.8.0',
                        synopsis: 'Package errgroup provides synchronization, error propagation, and Context cancelation for groups of goroutines.',
                        importedByCount: 94210,
                        matchedPackage: 'golang.org/x/sync/errgroup',
                      },
                      {
                        modulePath: 'golang.org/x/text',
                        latestVersion: 'v0.14.0',
                        synopsis: 'Package text provides text manipulation and internationalization utilities.',
                        importedByCount: 82100,
                      },
                    ],
                  },
                  '*',
                );
              }, 0);
            } else if (message && message.type === 'module-metadata') {
              setTimeout(function () {
                window.postMessage(
                  {
                    type: 'module-metadata',
                    modulePath: message.modulePath,
                    metadata: {
                      modulePath: message.modulePath,
                      version: message.version || 'v1.8.1',
                      publishedAt: '2024-06-12T16:12:00Z',
                      licenses: ['Apache-2.0'],
                      repoUrl: 'https://' + message.modulePath,
                    },
                  },
                  '*',
                );
              }, 0);
            }
          },
        };
      };
    </script>
    <script src="./webview.js"></script>
  </body>
</html>`;

writeFileSync('dist/harness.html', html);
console.log('dist/harness.html ready');
