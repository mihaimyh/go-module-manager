import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AdvisoryCache, CachedAdvisoryDb } from '../ecosystems/go/advisorySource';

/** Advisory cache on disk, under the extension's global storage. */
export class FileAdvisoryCache implements AdvisoryCache {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CachedAdvisoryDb | undefined> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as CachedAdvisoryDb;
    } catch {
      return undefined;
    }
  }

  async write(db: CachedAdvisoryDb): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(db), 'utf8');
  }
}
