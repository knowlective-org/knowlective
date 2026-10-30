// Static checks for access control in apps/web (pnpm check:auth). Fails the
// run when:
//
// 1. An exported function of a "use server" file (a Server Action: anyone can
//    POST to it) doesn't call one of the GUARDS itself.
// 2. An exported HTTP method of a Route Handler (route.ts) doesn't either.
// 3. App code imports the page access functions from "shared" directly instead
//    of lib/page-access.ts (which applies the network policy).
//
// A function may also call a helper in the same file that calls one of the
// GUARDS (e.g. a share action's requireManager()). A function that is
// deliberately open (a login form, a static file) says so in a comment right
// above it: `// auth: public — <why>`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "apps/web/src");

// Calls that establish who is asking and check what they may do.
const GUARDS = [
  "requireUser",
  "requireAdmin",
  "getCurrentUser",
  "getSessionUser",
  "getPasskeySetupUser",
  "getAdminSession",
  "withApiKey",
  "authenticateApiKey",
  "findAccessiblePage",
  "getPageAccess",
];
const PAGE_ACCESS_FUNCTIONS = ["getPageAccess", "getVisibleTree", "getVisibleTrees", "getTreeWithAccess", "getTrash"];
// Where importing those from "shared" is right: the wrapper itself, and the
// admin console (not limited by network: lib/network-policy.ts).
const SHARED_ACCESS_ALLOWED = [/^lib\/page-access\.ts$/, /^lib\/group-access\.ts$/, /^lib\/landing-page\.ts$/, /^app\/admin\//];
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const problems = [];
const rel = (file) => path.relative(SRC, file).replaceAll("\\", "/");

// The `// auth: …` note in the comments right above a node, if any.
function authNote(source, node) {
  const comments = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  for (const c of comments) {
    const m = /\/\/\s*auth:\s*(.+)/.exec(source.text.slice(c.pos, c.end));
    if (m) return m[1].trim();
  }
  return null;
}

function callsGuard(node, guards) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name && guards.includes(name)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// Exported functions: `export async function f`, `export const f = async () =>`.
function exportedFunctions(source) {
  const result = [];
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      result.push({ name: statement.name.text, node: statement, body: statement.body });
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          result.push({ name: d.name.text, node: statement, body: init.body });
        }
      }
    }
  }
  return result;
}

const isUseServer = (source) =>
  source.statements.length > 0 &&
  ts.isExpressionStatement(source.statements[0]) &&
  ts.isStringLiteral(source.statements[0].expression) &&
  source.statements[0].expression.text === "use server";

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const where = rel(file);

  const isRoute = /(^|\/)route\.ts$/.test(where);
  if (isUseServer(source) || isRoute) {
    // This file's own helpers that check access count as guards (and helpers
    // calling those, to any depth).
    const guards = [...GUARDS];
    for (let added = true; added; ) {
      added = false;
      for (const s of source.statements) {
        if (ts.isFunctionDeclaration(s) && s.name && s.body && !guards.includes(s.name.text) && callsGuard(s.body, guards)) {
          guards.push(s.name.text);
          added = true;
        }
      }
    }
    for (const fn of exportedFunctions(source)) {
      if (isRoute && !HTTP_METHODS.has(fn.name)) continue;
      if (authNote(source, fn.node)) continue;
      if (!fn.body || !callsGuard(fn.body, guards)) {
        problems.push(`${where}: ${isRoute ? "route" : "Server Action"} ${fn.name}() calls no access check (${GUARDS.join(", ")}), and has no "// auth: …" note`);
      }
    }
  }

  if (!SHARED_ACCESS_ALLOWED.some((re) => re.test(where))) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "shared") continue;
      const names = statement.importClause?.namedBindings;
      if (!names || !ts.isNamedImports(names)) continue;
      for (const element of names.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (PAGE_ACCESS_FUNCTIONS.includes(imported)) {
          problems.push(`${where}: imports ${imported} from "shared"; use lib/page-access.ts (it applies the network policy)`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`check-auth: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("check-auth: ok");
