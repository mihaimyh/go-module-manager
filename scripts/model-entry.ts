import { join } from 'node:path';
import { loadFixtureWorkspace } from '../src/core/fixtures';

const root = join(process.cwd(), 'test', 'fixtures', 'workspace');

process.stdout.write(JSON.stringify(loadFixtureWorkspace(root)));
