import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(siteRoot, '..');
const manifestPath = join(siteRoot, '.generated', 'review-snippets.json');
const bblPath = join(repoRoot, 'semilocal_exchange_correlation_approximations', 'xc_concat.bbl');
const bibliographyPath = join(siteRoot, '.generated', 'review-bibliography.json');
const outputDir = join(siteRoot, '.generated', 'review-html');
const crossRefText = new Map([
  ['eq:wignerseitz1', 'the one-dimensional Wigner-Seitz radius'],
  ['eq:wignerseitz2', 'the two-dimensional Wigner-Seitz radius'],
  ['eq:wignerseitz3', 'the three-dimensional Wigner-Seitz radius'],
]);
const crossRefMath = new Map([
  ['eq:wignerseitz1', 'r_s^{1\\text{D}} = \\frac{1}{2 n}'],
  ['eq:wignerseitz2', 'r_s^{2\\text{D}} = \\frac{1}{\\sqrt{\\pi n}}'],
  ['eq:wignerseitz3', 'r_s^{3\\text{D}} = \\left(\\frac{3}{4\\pi n}\\right)^{1/3}'],
]);

function requirePandoc() {
  const result = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      [
        'Pandoc is required for review rendering but was not found in PATH.',
        'Install pandoc with citeproc support, then run:',
        '  npm run render:review',
        'The default site build can still use the fallback renderer.',
      ].join('\n'),
    );
  }
}

function cleanLatexText(value) {
  return String(value)
    .replace(/~/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\\latin\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[`'"^~=.] *\{?([A-Za-z])\}?/g, '$1')
    .replace(/[{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBibliography() {
  const bbl = readFileSync(bblPath, 'utf8');
  const entries = [];
  const pattern = /\\bibitem(?:\[(.*?)\])?\{([^}]*)\}([\s\S]*?)(?=\\mciteBstWouldAddEndPunct|\\EndOfBibitem|\\bibitem|\\end\{mcitethebibliography\})/g;
  let match;
  while ((match = pattern.exec(bbl))) {
    const [, label = '', id, body] = match;
    const authorLabel = cleanLatexText(label.split('(')[0] || 'Reference');
    const year = Number((label.match(/\((\d{4})\)/) || body.match(/\\textbf\{(\d{4})\}/) || [])[1]);
    const title = cleanLatexText(body.replace(/\\doi\{([^}]*)\}/g, 'DOI: $1'));
    entries.push({
      id,
      type: 'article-journal',
      author: [{ literal: authorLabel }],
      issued: Number.isFinite(year) ? { 'date-parts': [[year]] } : undefined,
      title,
    });
  }
  writeFileSync(bibliographyPath, `${JSON.stringify(entries, null, 2)}\n`);
}

function citeKeys(keys) {
  return keys
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function pandocCitation(keys, textual) {
  const items = citeKeys(keys).map((key) => `@${key}`);
  if (items.length === 0) return '';
  return textual ? items.join('; ') : `[${items.join('; ')}]`;
}

function equationNumberLabel(number, second, plural) {
  const label = plural || second ? 'Eqs.' : 'Eq.';
  return second ? `${label} (${number}) and (${second})` : `${label} (${number})`;
}

function normalizeExternalEquationRefs(tex) {
  return tex
    .replace(
      /eqs?\.~\(([^)]*)\)(?:\s+and\s+\(([^)]*)\))?\s+in\s+the\s+supplemental\s+material\s+of\s+\\citerefs?\{([^}]*)\}/g,
      (match, number, second, keys) =>
        `${equationNumberLabel(number, second, match.startsWith('eqs.'))} in the supplemental material of ${pandocCitation(keys, true)}`,
    )
    .replace(
      /eqs?\.~\(([^)]*)\)(?:\s+and\s+\(([^)]*)\))?\s+in\s+the\s+Erratum\\cite\{([^}]*)\}/g,
      (match, number, second, keys) =>
        `${equationNumberLabel(number, second, match.startsWith('eqs.'))} of the Erratum by ${pandocCitation(keys, true)}`,
    )
    .replace(
      /eqs?\.~\(([^)]*)\)(?:\s+and\s+\(([^)]*)\))?\s+of\s+the\s+original\s+paper,\\cite\{([^}]*)\}/g,
      (match, number, second, keys) =>
        `${equationNumberLabel(number, second, match.startsWith('eqs.'))} of ${pandocCitation(keys, true)}`,
    )
    .replace(
      /eqs?\.~\(([^)]*)\)(?:\s+and\s+\(([^)]*)\))?\s+(?:in|of)\s+\\citerefs?\{([^}]*)\}/g,
      (match, number, second, keys) =>
        `${equationNumberLabel(number, second, match.startsWith('eqs.'))} of ${pandocCitation(keys, true)}`,
    )
    .replace(
      /eqs?\.~\(([^)]*)\)(?:\s+and\s+\(([^)]*)\))?/g,
      (match, number, second) => equationNumberLabel(number, second, match.startsWith('eqs.')),
    )
    .replace(/~/g, ' ');
}

function functionalRef(label) {
  return label.toLowerCase().replace(/;/g, '_');
}

function crossRef(labels) {
  const ids = labels.split(',').map((item) => item.trim());
  const parts = ids.map((id) => {
    const phrase = crossRefText.get(id) || (id.startsWith('eq:') ? `\`${id}\`` : 'the review');
    const math = crossRefMath.get(id);
    return math ? `${phrase} $${math}$` : phrase;
  });
  if (parts.length > 0) return parts.join('; ');
  if (ids.every((id) => id.startsWith('eq:'))) {
    return ids.length === 1 ? 'the referenced equation' : 'the referenced equations';
  }
  return 'the review';
}

function rewriteCrossRefContext(tex) {
  return tex.replace(
    /\$r_s=r_s\^\{1\\text\{D\}\}\$, \\cref\{eq:wignerseitz1\}/g,
    () => '$r_s$ denotes \\cref{eq:wignerseitz1}',
  );
}

function snippetToMarkdown(tex) {
  let s = normalizeExternalEquationRefs(rewriteCrossRefContext(tex)).replace(/\\begin\{subequations\}|\\end\{subequations\}/g, '');
  s = s.replace(/m\{\\Eh\}|m\\Eh\{\}/g, '$\\mathrm{m}E_{\\mathrm{h}}$');
  s = s.replace(/\{\\Eh\}|\\Eh\{\}|\\Eh/g, '$E_{\\mathrm{h}}$');
  s = s.replace(/\{\\o\}|\\o\{\}|\\o(?![A-Za-z])/g, '&oslash;');
  s = s.replace(/\{\\O\}|\\O\{\}|\\O(?![A-Za-z])/g, '&Oslash;');
  s = s.replace(/---/g, '&mdash;');
  s = s.replace(/--/g, '&ndash;');
  s = s.replace(/\\I/g, '\\mathrm{i}');
  s = s.replace(/\\D/g, '\\mathrm{d}');
  s = s.replace(/\\E/g, '\\mathrm{e}');
  s = s.replace(/\\Hxc/g, '\\mathrm{Hxc}');
  s = s.replace(/\\Hx/g, '\\mathrm{Hx}');
  s = s.replace(/\\xc/g, '\\mathrm{xc}');
  s = s.replace(/\\x/g, '\\mathrm{x}');
  s = s.replace(/\\octopus/g, 'Octopus');
  s = s.replace(/\\etal/g, 'et al.');
  s = s.replace(/\\xcref\{([^}]*)\}/g, (_, label) => `\`${functionalRef(label)}\``);
  s = s.replace(/\\[Cc]ref\{([^}]*)\}/g, (_, labels) => crossRef(labels));
  s = s.replace(/\\citet\{([^}]*)\}/g, (_, keys) => pandocCitation(keys, true));
  s = s.replace(/\\citerefs?\{([^}]*)\}/g, (_, keys) => pandocCitation(keys, false));
  s = s.replace(/\\citenum\{([^}]*)\}/g, (_, keys) => pandocCitation(keys, false));
  s = s.replace(/\\cite\{([^}]*)\}/g, (_, keys) => pandocCitation(keys, false));
  s = s.replace(/\\begin\{(equation|align|multline|gather)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_, env, body) => {
    const math = body
      .replace(/\\label\{[^}]*\}/g, '')
      .replace(/\\nonumber/g, '')
      .replace(/\\cite[a-zA-Z]*\{[^}]*\}/g, '')
      .trim();
    if (env === 'align') return `\n\n$$\\begin{aligned}\n${math}\n\\end{aligned}$$\n\n`;
    if (env === 'gather') return `\n\n$$\\begin{gathered}\n${math}\n\\end{gathered}$$\n\n`;
    return `\n\n$$\n${math}\n$$\n\n`;
  });
  s = s.replace(/\\texttt\{([^}]*)\}/g, '`$1`');
  s = s.replace(/\{\\em ([^}]*)\}/g, '*$1*');
  s = s.replace(/\\emph\{([^}]*)\}/g, '*$1*');
  s = s.replace(/\\begin\{itemize\}|\\end\{itemize\}/g, '');
  s = s.replace(/\\item/g, '-');
  return s.trim();
}

function splitPandocHtml(html) {
  const refsMatch = html.match(/<div id="refs"[\s\S]*$/);
  if (!refsMatch) return { body: html.trim(), refs: '' };
  const body = html.slice(0, refsMatch.index).trim();
  const refs = refsMatch[0].trim();
  return { body, refs };
}

function renderSnippet(snippet) {
  const inputPath = join(siteRoot, snippet.input);
  const markdown = snippetToMarkdown(readFileSync(inputPath, 'utf8'));
  const result = spawnSync(
    'pandoc',
    [
      '--from=markdown+tex_math_dollars+citations',
      '--to=html',
      '--citeproc',
      `--bibliography=${bibliographyPath}`,
      '--metadata=link-citations=true',
    ],
    { input: markdown, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`Pandoc failed for ${snippet.key}:\n${result.stderr}`);
  }
  const { body, refs } = splitPandocHtml(result.stdout);
  writeFileSync(join(siteRoot, snippet.html), `${body}\n`);
  writeFileSync(join(siteRoot, snippet.referencesHtml), `${refs}\n`);
}

function main() {
  requirePandoc();
  if (!existsSync(manifestPath)) {
    throw new Error('Missing review snippet manifest. Run npm run build:extract first.');
  }
  mkdirSync(outputDir, { recursive: true });
  parseBibliography();

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const snippet of manifest.snippets) {
    renderSnippet(snippet);
  }
  console.log(`Rendered ${manifest.snippets.length} review snippets with Pandoc.`);
}

main();
