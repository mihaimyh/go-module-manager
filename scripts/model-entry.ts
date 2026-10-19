import { join } from 'node:path';
import { goAdapter } from '../src/ecosystems/go/adapter';

const root = join(process.cwd(), 'test', 'fixtures', 'workspace');

void goAdapter.read(root).then((model) => {
  process.stdout.write(JSON.stringify(model));
});
