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
