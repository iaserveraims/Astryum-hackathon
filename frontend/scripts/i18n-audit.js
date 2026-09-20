#!/usr/bin/env node
/**
 * Auditoría AST de i18n: toda clave t('literal') debe tener entrada ES.
 * El dict son DOS objetos (ES exportado + PAGES const interna) — se transpila
 * el módulo y se exporta PAGES a mano. Uso: node frontend/scripts/i18n-audit.js
 * (desde cualquier cwd). Vivía en el scratchpad de sesión y se recreaba una y
 * otra vez — versionado el 2026-08-17 para que sobreviva.
 */
const path = require('path');
const fs = require('fs');

const FRONTEND = path.resolve(__dirname, '..');
const ROOT = path.resolve(FRONTEND, '..');
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
const SRC = path.join(FRONTEND, 'src');

const dictSrc = fs.readFileSync(path.join(SRC, 'i18n/dict.ts'), 'utf8');
const js = ts.transpileModule(dictSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js + '\nmodule.exports.PAGES = PAGES;')(mod, mod.exports, require);
const TABLE = { ...(mod.exports.ES ?? {}), ...(mod.exports.PAGES ?? {}) };

const missing = new Map();
function walkDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') walkDir(p);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) checkFile(p);
  }
}
function checkFile(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const key = node.arguments[0].text;
      if (!(key in TABLE)) {
        if (!missing.has(key)) missing.set(key, []);
        missing.get(key).push(path.relative(SRC, file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
walkDir(SRC);
if (missing.size === 0) {
  console.log('OK: 0 claves t() sin entrada ES');
} else {
  console.log(`FALTAN ${missing.size} claves:`);
  for (const [k, files] of missing) console.log(`- "${k}" ← ${[...new Set(files)].join(', ')}`);
  process.exitCode = 1;
}
