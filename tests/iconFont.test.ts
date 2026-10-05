// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Icons come from a self-hosted font cut down to the icons src/ uses
 * (scripts/icon-font/build.py). An icon added to the code but not to the font
 * renders as its raw name, e.g. the word "check_circle" on screen — silently,
 * and only for users without the full font cached. This makes it loud.
 */

const root = join(__dirname, '..');
const allNames = new Set(readFileSync(join(root, 'scripts/icon-font/all-icon-names.txt'), 'utf8').split('\n').filter(Boolean));
const inFont = new Set<string>(
  (JSON.parse(readFileSync(join(root, 'src/assets/fonts/icons.json'), 'utf8')) as { icons: string[] }).icons,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('the icon font', () => {
  it('contains every icon the source code uses', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(root, 'src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['"`]([a-z][a-z0-9_]{1,48})['"`]/g)) {
        if (allNames.has(match[1]!)) used.add(match[1]!);
      }
    }
    const missing = [...used].filter((name) => !inFont.has(name)).sort();
    expect(missing, 'Run: python3 scripts/icon-font/build.py').toEqual([]);
  });

  it('stays small enough for a campus phone and for the offline precache', () => {
    const bytes = statSync(join(root, 'src/assets/fonts/material-symbols-rounded-subset.woff2')).size;
    expect(bytes).toBeLessThan(64 * 1024);
  });
});
