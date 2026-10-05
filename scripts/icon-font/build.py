#!/usr/bin/env python3
"""
Build the self-hosted icon font: Material Symbols Rounded, cut down to the
icons this app actually uses.

Why: the app used to load every icon from fonts.googleapis.com at runtime.
On a campus LAN with no internet — the case the on-premise kit exists for —
a first-time visitor then saw raw ligature text ("check_circle") instead of
icons. Self-hosting the whole font is no answer either: it is 5.4 MB, too
heavy for a campus phone and over the service worker's 4 MB precache limit.

What it does:
  1. finds every quoted snake_case string in src/ that is a Material Symbols
     icon name (a superset of what is drawn, which is harmless)
  2. keeps only those icons and the letters that spell them, with the
     ligature features intact
  3. pins the axes the app never changes (weight 400, grade 0, optical size
     24) and keeps FILL, which the app uses for filled icons

Run after adding an icon:
    pip install fonttools brotli uharfbuzz
    npm install --no-save material-symbols@<version below>
    python3 scripts/icon-font/build.py

tests/iconFont.test.ts fails if src/ uses an icon this font does not have.
"""
import json
import re
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'node_modules/material-symbols/material-symbols-rounded.woff2'
OUT_FONT = ROOT / 'src/assets/fonts/material-symbols-rounded-subset.woff2'
OUT_LIST = ROOT / 'src/assets/fonts/icons.json'
ALL_NAMES = ROOT / 'scripts/icon-font/all-icon-names.txt'
# The npm version the subset was cut from. Change it deliberately.
PINNED_VERSION = '0.47.6'

LITERAL = re.compile(r"""['"`]([a-z][a-z0-9_]{1,48})['"`]""")


def ligature_targets(font: TTFont) -> dict[str, str]:
    """Icon name -> the glyph it draws. Usually the same word, but not always:
    some names are aliases ('email' draws the 'mail' glyph), so glyphs must be
    kept by what the ligature resolves to, never by name."""
    cmap = {glyph: chr(code) for code, glyph in font.getBestCmap().items()}
    targets: dict[str, str] = {}
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            table = sub.ExtSubTable if lookup.LookupType == 7 else sub
            for first, ligs in (getattr(table, 'ligatures', None) or {}).items():
                for lig in ligs:
                    name = ''.join(cmap.get(g, '\0') for g in [first] + lig.Component)
                    if '\0' not in name:
                        targets[name] = lig.LigGlyph
    return targets


def used_in_source(known: set[str]) -> list[str]:
    found = set()
    for path in (ROOT / 'src').rglob('*.ts*'):
        found.update(LITERAL.findall(path.read_text(encoding='utf-8')))
    return sorted(found & known)


def main() -> None:
    if not SOURCE.exists():
        sys.exit(f'Missing {SOURCE.relative_to(ROOT)}. Run: npm install --no-save material-symbols@{PINNED_VERSION}')

    font = TTFont(SOURCE)
    targets = ligature_targets(font)
    known = set(targets)
    icons = used_in_source(known)

    # Every letter that spells an icon name, plus the icon glyphs themselves.
    letters = sorted({ch for name in icons for ch in name})
    cmap = font.getBestCmap()
    keep = [cmap[ord(ch)] for ch in letters] + sorted({targets[name] for name in icons})

    options = Options()
    options.flavor = 'woff2'
    options.layout_features = ['rlig', 'rclt', 'liga']
    # Closure would pull in every ligature reachable from a-z: all 4,000.
    options.layout_closure = False
    options.notdef_outline = True
    options.name_IDs = ['*']
    subsetter = Subsetter(options)
    subsetter.populate(glyphs=keep)
    subsetter.subset(font)

    font = instantiateVariableFont(font, {'wght': 400, 'GRAD': 0, 'opsz': 24})
    font.flavor = 'woff2'
    font.save(OUT_FONT)

    OUT_LIST.write_text(json.dumps({'source': f'material-symbols@{PINNED_VERSION}', 'icons': icons}, indent=2) + '\n')
    ALL_NAMES.write_text('\n'.join(sorted(known)) + '\n')
    print(f'{len(icons)} icons -> {OUT_FONT.relative_to(ROOT)} ({OUT_FONT.stat().st_size / 1024:.1f} KiB)')


if __name__ == '__main__':
    main()
