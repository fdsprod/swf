import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]).filter(file => /\.[cm]?tsx?$/.test(file));
}

export function checkArchitecture(root) {
  root = resolve(root);
  const errors = [];
  const visited = new Set();
  const queue = files(join(root, 'src/kernel'));
  if (!queue.length) errors.push('No kernel source files found');
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const syntax = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspectSpecifier(node) {
      if (!node || !ts.isStringLiteralLike(node)) {
        errors.push(`${relative(root, file)}: computed module loading cannot establish the kernel boundary`);
        return;
      }
      const specifier = node.text;
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('node:') || specifier === 'ajv' || specifier.startsWith('ajv/')) return;
        errors.push(`${relative(root, file)}: forbidden external kernel dependency ${specifier}`);
        return;
      }
      const target = resolve(dirname(file), specifier);
      const path = relative(join(root, 'src'), target).replaceAll('\\', '/');
      const sourcePath = relative(join(root, 'src'), file).replaceAll('\\', '/');
      if (sourcePath.startsWith('contracts/') && path.startsWith('kernel/')) {
        errors.push(`${relative(root, file)}: contracts cannot depend on kernel: ${specifier}`);
        return;
      }
      if (isAbsolute(path) || (!path.startsWith('kernel/') && !path.startsWith('contracts/'))) {
        errors.push(`${relative(root, file)}: kernel dependency leaves kernel/contracts: ${specifier}`);
        return;
      }
      if (extname(target) === '.json') return;
      const choices = [target.replace(/\.js$/, '.ts'), target, `${target}.ts`, join(target, 'index.ts')];
      const found = choices.find(choice => existsSync(choice) && /\.[cm]?tsx?$/.test(choice));
      if (!found) errors.push(`${relative(root, file)}: unresolved local dependency ${specifier}`);
      else queue.push(found);
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) inspectSpecifier(node.moduleSpecifier);
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) inspectSpecifier(node.moduleReference.expression);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) inspectSpecifier(node.arguments[0]);
      ts.forEachChild(node, visit);
    }
    visit(syntax);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.env.FACTORY_CANDIDATE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../../..'));
  const errors = checkArchitecture(root);
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write('ARC-001 passed: kernel dependency graph stays within kernel/contracts and allowed libraries.\n');
}
