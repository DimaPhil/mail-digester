import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const contract = JSON.parse(
  fs.readFileSync("contracts/operations.json", "utf8"),
);
const methods = new Set([
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const expected = new Map(
  contract.operations.map((op) => [op.method + " " + op.path, op.id]),
);
if (
  expected.size !== contract.operations.length ||
  new Set(contract.operations.map((o) => o.id)).size !== expected.size ||
  new Set(contract.operations.map((o) => o.command)).size !== expected.size
)
  throw new Error("Duplicate REST method/path, operation ID, or CLI command.");
const seen = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!/^route\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const route =
      "/" +
      path
        .dirname(file)
        .replace(/^app\//, "")
        .replaceAll(/\[(\w+)\]/g, "{$1}");
    const source = fs.readFileSync(file, "utf8");
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of parsed.statements) {
      if (ts.isExportDeclaration(node)) {
        if (
          !node.exportClause ||
          (ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.some((e) => methods.has(e.name.text)))
        )
          throw new Error(
            "Export API handlers directly through apiOperation: " + file,
          );
        continue;
      }
      if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
        continue;
      const declarations = ts.isVariableStatement(node)
        ? node.declarationList.declarations
        : ts.isFunctionDeclaration(node)
          ? [node]
          : [];
      for (const declaration of declarations) {
        const method = declaration.name?.getText(parsed);
        if (!methods.has(method)) continue;
        const label = method + " " + route;
        if (
          contract.retired.some(
            (r) => r.path === route && r.methods.includes(method),
          )
        ) {
          if (!source.includes("status: 410"))
            throw new Error("Retired route must return 410: " + label);
          seen.add(label);
          continue;
        }
        const call = declaration.initializer;
        if (
          !expected.has(label) ||
          !call ||
          !ts.isCallExpression(call) ||
          call.expression.getText(parsed) !== "apiOperation" ||
          call.arguments[0]?.text !== expected.get(label)
        )
          throw new Error(
            "REST/CLI drift at " +
              label +
              ". Register this method/path in lib/api/contracts.ts and wrap it with apiOperation; run npm run api:contracts and extend conformance tests/skill guidance.",
          );
        seen.add(label);
      }
    }
  }
}
walk("app/api");
for (const label of expected.keys())
  if (!seen.has(label))
    throw new Error("CLI operation has no REST route: " + label);
for (const route of contract.retired)
  for (const method of route.methods)
    if (!seen.has(method + " " + route.path))
      throw new Error(
        "Retired route declaration is stale: " + method + " " + route.path,
      );
console.log(
  `REST/CLI alignment: ${expected.size} active operations; every route registered.`,
);
