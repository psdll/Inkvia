import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HAN = /[\p{Script=Han}]/u;
const UI_ATTRIBUTES = new Set([
  "title", "placeholder", "aria-label", "alt", "label", "description", "hint", "emptyText",
  "loadingText", "confirmText", "cancelText", "aria-description", "ariaLabel",
]);

function files(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.[cm]?tsx?$/.test(entry.name))
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
}

function labelValues(expression, emit, templates = false) {
  if (!expression) return;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    if (HAN.test(expression.text)) emit(expression);
  } else if (templates && ts.isTemplateExpression(expression)) {
    if (HAN.test(expression.head.text) || expression.templateSpans.some(span => HAN.test(span.literal.text))) emit(expression);
  } else if (ts.isConditionalExpression(expression)) {
    labelValues(expression.whenTrue, emit, templates);
    labelValues(expression.whenFalse, emit, templates);
  } else if (ts.isParenthesizedExpression(expression)) {
    labelValues(expression.expression, emit, templates);
  } else if (ts.isBinaryExpression(expression) && [
    ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken,
  ].includes(expression.operatorToken.kind)) {
    // The right-hand side can be displayed as a fallback or as conditional text.
    labelValues(expression.right, emit, templates);
  }
}

export function readJsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const last = lines.findLastIndex(line => /[^\t ]/.test(line));
  return lines.map((line, index) => {
    let text = line.replaceAll("\t", " ");
    if (index > 0) text = text.replace(/^ +/, "");
    if (index < lines.length - 1) text = text.replace(/ +$/, "");
    return text && index !== last ? text + " " : text;
  }).join("");
}

export function scanFile(file) {
  const content = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const edits = [];
  const unmapped = [];
  const messageRefs = [];
  const api = file.startsWith("app/api/");
  const known = new Set();
  const record = (kind, node, value, extra) => {
    const start = kind === "jsxText" ? node.pos : node.getStart(ast);
    known.add(node);
    edits.push({ kind, start, end: node.end, value, ...extra });
  };
  function visit(node) {
    if (ts.isJsxText(node) && HAN.test(node.text)) {
      const parent = ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText(ast) : "";
      // Language names are intentionally autonyms. Script/style must remain code.
      if (!["style", "script", "option"].includes(parent) && !node.text.includes("&") && node.text.trim() !== "简体中文") {
        record("jsxText", node, readJsxText(node.text));
      }
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      labelValues(node.expression, leaf => {
        if (!ts.isTemplateExpression(leaf)) { record("jsxExpression", leaf, leaf.text); return; }
        const values = Object.fromEntries(leaf.templateSpans.map((span, i) => ["v" + i, span.expression.getText(ast)]));
        const value = leaf.head.text + leaf.templateSpans.map((span, i) => "{v" + i + "}" + span.literal.text).join("");
        record("jsxTemplate", leaf, value, { values });
      }, true);
    }
    if (ts.isJsxAttribute(node)) {
      const attr = node.name.getText(ast);
      const tag = node.parent.parent.tagName.getText(ast);
      if (attr === "id" && tag === "UiText" && node.initializer && ts.isStringLiteral(node.initializer)) {
        messageRefs.push(node.initializer.text);
      }
      if (attr === "ids" && tag === "UiProps" && node.initializer && ts.isJsxExpression(node.initializer)) {
        const ids = node.initializer.expression;
        if (ids && ts.isObjectLiteralExpression(ids)) {
          for (const property of ids.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) continue;
            for (const entry of property.initializer.elements) {
              if (ts.isStringLiteral(entry)) messageRefs.push(entry.text);
            }
          }
        }
      }
      if (UI_ATTRIBUTES.has(attr)) {
        const opening = node.parent.parent;
        const el = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
        // Gallery labels also identify the stored media role in the workbench.
        if (attr === "label" && opening.tagName.getText(ast) === "BatchMediaGallery") return;
        const group = { attr, startTag: el.getStart(ast), endTag: el.end };
        const value = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        labelValues(value, leaf => record("attr", leaf, leaf.text, { ...group, bare: leaf === node.initializer }));
      }
    }
    if (api && ts.isPropertyAssignment(node) && propertyName(node.name) === "error"
      && ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent)
      && /(?:^|\.)(json|[A-Za-z]+Json)$/.test(node.parent.parent.expression.getText(ast))) {
      labelValues(node.initializer, leaf => record("apiError", leaf, leaf.text));
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression.getText(ast);
      if (callee === "text" && /^[\w-]+\.[\w-]+$/.test(node.arguments[0].text)) messageRefs.push(node.arguments[0].text);
      if (callee === "apiMessage") messageRefs.push("errors." + node.arguments[0].text);
    }
    if ((ts.isStringLiteral(node) || ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && HAN.test(node.getText(ast)) && !known.has(node)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
        unmapped.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text: node.getText(ast) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { file, edits, unmapped, messageRefs, content, ast };
}

export function listSources() {
  return ["app", "components", "hooks"].flatMap(files);
}

function leafEntries(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "string" ? [[prefix + key, value]] : leafEntries(value, prefix + key + "."));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const toEntries = locale => new Map(leafEntries(JSON.parse(fs.readFileSync(`messages/${locale}.json`, "utf8"))));
  const zh = toEntries("zh-CN");
  const en = toEntries("en");
  const variables = (value) => [...value.matchAll(/\{(\w+)\}|%[sd]/g)].map(match => match[1] ?? match[0]).sort().join(",");
  const invalid = [...new Set([...zh.keys(), ...en.keys()])].filter(key => {
    const source = zh.get(key);
    const target = en.get(key);
    return !source?.trim() || !target?.trim() || target.includes("▁") || variables(source) !== variables(target);
  });
  const sources = listSources().map(scanFile);
  const remaining = sources.reduce((sum, s) => sum + s.edits.length, 0);
  const review = new Set(sources.flatMap(s => s.unmapped.map(item => item.text)));
  const missing = new Set(sources.flatMap(source => source.messageRefs.filter(id => !zh.has(id) || !en.has(id))));
  console.log(`词典 ${zh.size} 条，键、空值或占位符问题 ${invalid.length} 条。`);
  console.log(`代码引用了 ${missing.size} 个缺失的词典键。`);
  for (const id of missing) console.log(`缺失词典键 ${id}`);
  console.log(`可静态定位的界面或 API 中文残留 ${remaining} 处。`);
  console.log(`另有 ${review.size} 条其他中文字符串待分类（含动态界面、数据、提示词等）。`);
  if (process.argv.includes("--details")) {
    for (const source of sources) {
      for (const item of source.edits) console.log(source.file, "界面", item.value.trim());
      for (const item of source.unmapped) console.log(`${source.file}:${item.line}`, "待分类", item.text);
    }
  }
  if (invalid.length || remaining || missing.size) process.exitCode = 1;
}
