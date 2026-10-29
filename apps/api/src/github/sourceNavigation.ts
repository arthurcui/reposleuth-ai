/** Parses bounded source metadata only; never evaluates code or resolves a semantic call graph. */
import ts from 'typescript';

import type { RepositoryRevision, SourceDefinition, SourceOutline } from './RepositoryProvider.js';

export function sourceOutline(
  revision: RepositoryRevision,
  path: string,
  source: string,
  query = '',
): SourceOutline {
  const totalLines = source ? source.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
  const base = { ...revision, path, totalLines };
  const definitions: SourceDefinition[] = [];
  const imports: SourceOutline['imports'] = [];
  const calls: SourceOutline['calls'] = [];
  const warnings: string[] = [];
  if (/\.[cm]?[jt]sx?$/.test(path)) {
    const ast = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      /x$/.test(path)
        ? ts.ScriptKind.TSX
        : /\.[cm]?js$/.test(path)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
    );
    const line = (position: number) => ast.getLineAndCharacterOfPosition(position).line + 1;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))
      )
        calls.push({
          name: node.expression.getText(ast).slice(0, 120),
          line: line(node.getStart(ast)),
        });
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        imports.push({
          specifier: node.moduleSpecifier.text,
          line: line(node.getStart(ast)),
          candidates: [],
        });
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push({
          specifier: node.moduleSpecifier.text,
          line: line(node.getStart(ast)),
          candidates: [],
        });
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
      ) {
        if (node.name)
          definitions.push({
            name: node.name.getText(ast).slice(0, 120),
            kind: ts.SyntaxKind[node.kind],
            startLine: line(node.getStart(ast)),
            endLine: line(node.end),
            implementation:
              ts.isClassDeclaration(node) ||
              ts.isEnumDeclaration(node) ||
              ts.isVariableDeclaration(node) ||
              ('body' in node && !!node.body),
            scopeStartOffset: node.parent.getStart(ast),
          });
      }
      // Statically named function-valued assignments/properties (no expression evaluation).
      if (
        (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
        !('name' in node && node.name)
      ) {
        const parent = node.parent;
        const name =
          ts.isPropertyAssignment(parent) &&
          (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
            ? parent.name.text
            : ts.isBinaryExpression(parent) &&
                parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isPropertyAccessExpression(parent.left)
              ? parent.left.name.text
              : null;
        if (name)
          definitions.push({
            name,
            kind: 'FunctionProperty',
            startLine: line(parent.getStart(ast)),
            endLine: line(parent.end),
            implementation: true,
            scopeStartOffset: parent.parent.getStart(ast),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    warnings.push(
      'Syntax locations only: overloads and similarly named definitions are not resolved references.',
    );
    const parse = ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
    if (parse.parseDiagnostics?.length)
      warnings.push(
        'Parse errors: locations may be incomplete; use bounded literal search/read_file.',
      );
    return {
      ...base,
      parser: 'typescript',
      calls: calls.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
      definitions: definitions
        .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 80),
      imports: imports.slice(0, 40),
      truncated:
        definitions.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())).length > 80 ||
        imports.length > 40 ||
        calls.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).length > 80,
      warnings,
    };
  }
  if (/\.cs$/.test(path)) {
    // Deliberately only line anchors: no guessed method bodies or overload resolution.
    const lines = source.split(/\r?\n/);
    for (const [i, text] of lines.entries()) {
      const match =
        /^\s*(?:(?:public|private|protected|internal|static|async|virtual|override|sealed|partial|abstract)\s+)+(?:[\w<>,?[\].]+\s+)?([A-Za-z_]\w*)\s*(?:\(|\{|:)/.exec(
          text,
        );
      if (match)
        definitions.push({
          name: match[1]!,
          kind: 'lexical-anchor',
          startLine: i + 1,
          endLine: i + 1,
          implementation: false,
          scopeStartOffset: 0,
        });
    }
    return {
      ...base,
      parser: 'lexical',
      calls: [],
      definitions: definitions
        .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 80),
      imports: [],
      truncated:
        definitions.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())).length > 80,
      warnings: [
        'C# lexical declaration candidates only; comments/strings may match. No body or semantic resolution. Use read_file around the returned line.',
      ],
    };
  }
  return {
    ...base,
    parser: 'unsupported',
    calls: [],
    definitions: [],
    imports: [],
    truncated: false,
    warnings: ['No outline parser for this language; use bounded search_code and read_file.'],
  };
}
