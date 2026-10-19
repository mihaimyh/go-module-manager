import { describe, expect, it } from 'vitest';
import { workspaceRoots } from './workspaceRoots';

function folder(fsPath: string): { uri: { fsPath: string } } {
  return { uri: { fsPath } };
}

describe('workspaceRoots', () => {
  it('prefers a development override', () => {
    expect(
      workspaceRoots([folder('/a'), folder('/b')], '/fixture'),
    ).toEqual(['/fixture']);
  });

  it('returns every workspace folder when there is no override', () => {
    expect(workspaceRoots([folder('/a'), folder('/b')], undefined)).toEqual([
      '/a',
      '/b',
    ]);
  });

  it('returns nothing when there are no folders', () => {
    expect(workspaceRoots(undefined, undefined)).toEqual([]);
    expect(workspaceRoots([], undefined)).toEqual([]);
  });
});
