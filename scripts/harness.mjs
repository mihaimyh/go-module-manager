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
              var page = message.pageToken ? Number(message.pageToken) : 0;
              var nextPageToken = page < 3 ? String(page + 1) : undefined;
              var items = [];
              for (var index = 0; index < 25; index += 1) {
                var number = page * 25 + index;
                items.push({
                  name: 'example.com/module-' + number,
                  version: 'v1.0.' + number,
                  summary: 'Synthetic module ' + number + ' used by the Browse harness to exercise paging.',
                  importedBy: 1000 - number,
                });
              }
              window.postMessage(
                { type: 'search-loading', query: message.query || '', append: Boolean(message.pageToken) },
                '*',
              );
              setTimeout(function () {
                window.postMessage(
                  {
                    type: 'search-results',
                    response: {
                      query: message.query || '',
                      items: items,
                      ...(nextPageToken === undefined ? {} : { nextPageToken }),
                    },
                    append: Boolean(message.pageToken),
                  },
                  '*',
                );
              }, 250);
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
