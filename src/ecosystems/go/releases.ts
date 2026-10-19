const BODY_LIMIT = 1500;

export interface GitHubRepo {
  readonly owner: string;
  readonly repo: string;
}

export interface ReleaseNotes {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

/** `github.com/owner/repo` or `github.com/owner/repo/vN`. */
export function githubReleaseRepo(modulePath: string): GitHubRepo | undefined {
  const match = /^github\.com\/([^/]+)\/([^/]+)(?:\/v\d+)?$/.exec(modulePath);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { owner: match[1], repo: match[2] };
}

export async function fetchReleaseNotes(
  modulePath: string,
  version: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<ReleaseNotes | undefined> {
  const repo = githubReleaseRepo(modulePath);
  if (repo === undefined) {
    return undefined;
  }

  try {
    const raw = await fetchJson(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${version}`,
    );
    return parseRelease(raw);
  } catch {
    return undefined;
  }
}

function parseRelease(raw: unknown): ReleaseNotes | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as {
    name?: unknown;
    tag_name?: unknown;
    body?: unknown;
    html_url?: unknown;
  };
  const url = typeof record.html_url === 'string' ? record.html_url : undefined;
  if (url === undefined) {
    return undefined;
  }
  const title =
    (typeof record.name === 'string' && record.name !== '' ? record.name : undefined) ??
    (typeof record.tag_name === 'string' ? record.tag_name : versionFallback(url));
  const body = typeof record.body === 'string' ? record.body : '';
  return {
    title,
    body: body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT).trimEnd()}…` : body,
    url,
  };
}

function versionFallback(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 1] ?? url;
}
