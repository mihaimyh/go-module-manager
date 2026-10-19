import { describe, expect, it } from 'vitest';
import { fetchReleaseNotes, githubReleaseRepo } from './releases';

describe('githubReleaseRepo', () => {
  it('reads owner/repo and strips a major suffix', () => {
    expect(githubReleaseRepo('github.com/gin-gonic/gin')).toEqual({
      owner: 'gin-gonic',
      repo: 'gin',
    });
    expect(githubReleaseRepo('github.com/gin-gonic/gin/v2')).toEqual({
      owner: 'gin-gonic',
      repo: 'gin',
    });
  });

  it('ignores non-GitHub paths', () => {
    expect(githubReleaseRepo('golang.org/x/text')).toBeUndefined();
    expect(githubReleaseRepo('gitlab.com/org/repo')).toBeUndefined();
  });
});

describe('fetchReleaseNotes', () => {
  it('returns title, truncated body and html url for the tag', async () => {
    const requested: string[] = [];
    const notes = await fetchReleaseNotes(
      'github.com/gin-gonic/gin',
      'v1.9.1',
      async (url) => {
        requested.push(url);
        return {
          name: 'Gin v1.9.1',
          body: 'Fixes.\n\nMore.',
          html_url: 'https://github.com/gin-gonic/gin/releases/tag/v1.9.1',
        };
      },
    );

    expect(requested).toEqual([
      'https://api.github.com/repos/gin-gonic/gin/releases/tags/v1.9.1',
    ]);
    expect(notes).toEqual({
      title: 'Gin v1.9.1',
      body: 'Fixes.\n\nMore.',
      url: 'https://github.com/gin-gonic/gin/releases/tag/v1.9.1',
    });
  });

  it('returns nothing on 404 and does not throw', async () => {
    await expect(
      fetchReleaseNotes('github.com/gin-gonic/gin', 'v0.0.1', async () => {
        throw new Error('404');
      }),
    ).resolves.toBeUndefined();
  });

  it('does not request a non-GitHub path', async () => {
    let called = 0;
    await expect(
      fetchReleaseNotes('rsc.io/quote', 'v1.5.2', async () => {
        called += 1;
        return {};
      }),
    ).resolves.toBeUndefined();
    expect(called).toBe(0);
  });
});
