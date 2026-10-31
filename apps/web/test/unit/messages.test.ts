import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else flatten(value, path, out);
  }
  return out;
}

/** Names of the arguments a message expects, plural and select branches included. */
function argumentsOf(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const element of elements) {
    if (
      element.type === TYPE.argument ||
      element.type === TYPE.number ||
      element.type === TYPE.date ||
      element.type === TYPE.time
    ) {
      out.add(element.value);
    } else if (element.type === TYPE.plural || element.type === TYPE.select) {
      out.add(element.value);
      for (const option of Object.values(element.options)) argumentsOf(option.value, out);
    } else if (element.type === TYPE.tag) {
      argumentsOf(element.children, out);
    }
  }
  return out;
}

const load = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf8')) as Tree;
const FR = flatten(load('fr'));
const EN = flatten(load('en'));

/** English values that legitimately keep a French accent (names of languages and places). */
const ACCENTS_ALLOWED = new Set(['common.fr', 'settings.structure.locales.fr']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('interface messages', () => {
  it('have the same keys in French and English', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(FR).sort());
  });

  it('parse as ICU messages with the same arguments in both languages', () => {
    for (const key of Object.keys(FR)) {
      const frArgs = [...argumentsOf(parse(FR[key] ?? ''))].sort();
      const enArgs = [...argumentsOf(parse(EN[key] ?? ''))].sort();
      expect(enArgs, key).toEqual(frArgs);
    }
  });

  it('leave no French text behind in English', () => {
    const suspicious = Object.entries(EN).filter(
      ([key, value]) => !ACCENTS_ALLOWED.has(key) && /[éèêàùçôî]/i.test(value),
    );
    expect(suspicious).toEqual([]);
  });

  it('contain every literal key the code asks for', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of sourceFiles(resolve(__dirname, '../../src'))) {
      const source = readFileSync(file, 'utf8');
      // Several components of one file each declare their own `t`: a call uses the
      // nearest declaration above it.
      const declarations = [
        ...source.matchAll(
          /const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:'([^']*)'|\{[^}]*namespace: '([^']*)'[^}]*\})?\)/g,
        ),
      ].map((m) => ({ name: m[1] ?? '', namespace: m[2] ?? m[3] ?? '', at: m.index }));
      for (const name of new Set(declarations.map((d) => d.name))) {
        for (const call of source.matchAll(new RegExp(`\\b${name}\\(\\s*'([^'$]+)'`, 'g'))) {
          const owner = declarations.filter((d) => d.name === name && d.at < call.index).at(-1);
          if (!owner) continue;
          checked += 1;
          const key = owner.namespace ? `${owner.namespace}.${call[1]}` : (call[1] ?? '');
          const isBranch = Object.keys(FR).some((k) => k.startsWith(`${key}.`));
          if (!(key in FR) && !isBranch) missing.push(`${file.split('src')[1]}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Guards the scan itself: it must keep finding the calls of the interface.
    expect(checked).toBeGreaterThan(500);
  });
});
