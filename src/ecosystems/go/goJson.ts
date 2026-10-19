export interface GoModRequire {
  readonly Path?: string;
  readonly Version?: string;
  readonly Indirect?: boolean;
}

export interface GoModJson {
  readonly Module?: {
    readonly Path?: string;
  };
  readonly Go?: string;
  readonly Require?: readonly GoModRequire[];
  readonly Replace?: readonly unknown[];
  readonly Exclude?: readonly unknown[];
}

export interface ModuleListEntry {
  readonly Path?: string;
  readonly Version?: string;
  readonly Time?: string;
  readonly Main?: boolean;
  readonly Dir?: string;
  readonly Update?: {
    readonly Path?: string;
    readonly Version?: string;
    readonly Time?: string;
  };
  readonly Error?: {
    readonly Err?: string;
  };
}

/**
 * `go list -m -json all` writes one JSON object per module, concatenated,
 * not an array. This splits a stream of top-level objects.
 */
export function parseJsonStream(raw: string): unknown[] {
  const text = stripBom(raw);
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(JSON.parse(text.slice(start, index + 1)));
        start = -1;
      }
    }
  }

  return objects;
}

export function parseGoModJson(raw: string): GoModJson {
  return JSON.parse(stripBom(raw)) as GoModJson;
}

export function parseModuleList(raw: string): ModuleListEntry[] {
  return parseJsonStream(raw).filter(isObject) as ModuleListEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
