/**
 * Guard against a silent compiler behaviour that eats a space from the UI.
 *
 * Next's compiler (SWC) drops the leading space of a multi-line JSX text when
 * that text contains an HTML entity (&apos;, &amp;, &quot;, &#215; ...). So
 *
 *   <strong>Reachable from the network.</strong> This server accepts
 *     connections ... the host&apos;s firewall rule is the control.
 *
 * renders as "network.This server" - the space after the bold phrase is gone
 * (found on the sign-in page, 2026-11-17; Babel and TypeScript keep it). The
 * trailing-space case and single-line texts are unaffected. The fix is to
 * keep entities out of such a text (a typographic apostrophe or quotation
 * mark is fine) or to break it so the text does not start on the tag's line.
 *
 * The first test pins the detector to the behaviour; the second scans every
 * web component so the pattern cannot return unnoticed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_SRC = fileURLToPath(new URL('../apps/web/src', import.meta.url));

/** Multi-line JSX text that begins on its opening tag's line and holds an entity. */
function entityTextsThatLoseTheirSpace(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const raw = source.text.slice(node.pos, node.end);
      if (raw.includes('\n') && /&[a-zA-Z0-9#]+;/.test(raw) && /^[ \t]+\S/.test(raw)) {
        const { line } = source.getLineAndCharacterOfPosition(node.pos);
        found.push(`${fileName}:${line + 1} ${JSON.stringify(raw.trim().slice(0, 60))}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('JSX text with an HTML entity keeps its leading space', () => {
  it('detects the shape the compiler mishandles and nothing else', () => {
    const bad = 'const a = <p><strong>x.</strong> the host&apos;s rule\n  is the control.</p>;';
    const singleLine = 'const a = <p><strong>x.</strong> the host&apos;s rule is the control.</p>;';
    const noEntity = 'const a = <p><strong>x.</strong> the hosts rule\n  is the control.</p>;';
    const ownLine =
      'const a = (\n  <p>\n    <strong>x.</strong>\n    the host&apos;s rule\n  </p>\n);';
    expect(entityTextsThatLoseTheirSpace('bad.tsx', bad)).toHaveLength(1);
    expect(entityTextsThatLoseTheirSpace('single.tsx', singleLine)).toEqual([]);
    expect(entityTextsThatLoseTheirSpace('plain.tsx', noEntity)).toEqual([]);
    expect(entityTextsThatLoseTheirSpace('own-line.tsx', ownLine)).toEqual([]);
  });

  it('no web component relies on it', () => {
    const files = tsxFiles(WEB_SRC);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((f) =>
      entityTextsThatLoseTheirSpace(path.relative(WEB_SRC, f), readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
