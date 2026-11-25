import { readFileSync } from "node:fs";
import ts from "typescript";
import messages from "@/messages/zh-CN.json";
import { fileURLToPath } from "node:url";

const dictionary = messages as Record<string, Record<string, string>>;
const cache = new Map<string, string>();

function message(id: string) {
  const [namespace, key] = id.split(".");
  return dictionary[namespace]?.[key];
}

function originalTemplate(original: string, values: ts.ObjectLiteralExpression, tree: ts.SourceFile) {
  const named = new Map(values.properties.filter(ts.isPropertyAssignment)
    .map(prop => [prop.name.getText(tree), prop.initializer.getText(tree).replace(/^String\(([\s\S]*)\)$/, "$1")]));
  return "`" + original.replace(/\{(\w+)\}/g, (token, name) => {
    const expression = named.get(name);
    return expression === undefined ? token : "${" + expression + "}";
  }) + "`";
}

/**
 * Existing source contracts assert the placement and exact Chinese copy of UI
 * controls. Resolve their actual dictionary references before those assertions.
 * A string present in the catalog alone cannot satisfy a source contract.
 */
export function readChineseUiSource(filename: string | URL, encoding: BufferEncoding): string {
  const file = typeof filename === "string" ? filename : fileURLToPath(filename);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(file, encoding);
  if (!/\.[cm]?tsx?$/.test(file) || !/\b(?:UiText|UiProps|apiMessage|text|label|uiLabel)\b/.test(source)) return source;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const changes: Array<{ start: number; end: number; value: string }> = [];
  const replace = (node: ts.Node, value: string) => {
    changes.push({ start: node.getStart(tree), end: node.end, value });
  };
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "UiText") {
      const id = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === "id");
      if (id && ts.isJsxAttribute(id) && id.initializer && ts.isStringLiteral(id.initializer)) {
        const original = message(id.initializer.text);
        if (original !== undefined) {
          const parent = node.parent;
          const isChild = (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) && parent.children.some(child => child === node);
          const values = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === "values");
          const object = values && ts.isJsxAttribute(values) && values.initializer && ts.isJsxExpression(values.initializer)
            ? values.initializer.expression : undefined;
          if (object && ts.isObjectLiteralExpression(object) && original.includes("{")) {
            const template = originalTemplate(original, object, tree);
            replace(node, isChild ? "{" + template + "}" : template);
            return;
          } else if (!values) {
            replace(node, isChild ? original : JSON.stringify(original));
            return;
          }
        }
      }
    } else if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "UiProps") {
      replace(node.openingElement, "");
      replace(node.closingElement, "");
    } else if (ts.isJsxAttribute(node) && node.initializer && node.parent.parent.tagName.getText(tree) !== "UiProps") {
      const opening = node.parent.parent;
      const element = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
      const wrapper = element.parent;
      if (ts.isJsxElement(wrapper) && wrapper.openingElement.tagName.getText(tree) === "UiProps") {
        const ids = wrapper.openingElement.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === "ids");
        const object = ids && ts.isJsxAttribute(ids) && ids.initializer && ts.isJsxExpression(ids.initializer)
          ? ids.initializer.expression : undefined;
        const names = object && ts.isObjectLiteralExpression(object)
          ? object.properties.find(prop => ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.name) && prop.name.text === node.name.getText(tree))
          : undefined;
        const allowed = names && ts.isPropertyAssignment(names) && ts.isArrayLiteralExpression(names.initializer)
          ? names.initializer.elements.filter(ts.isStringLiteral).map(id => id.text) : [];
        function resolve(candidate: ts.Node) {
          if (ts.isStringLiteral(candidate) && allowed.includes(candidate.text)) {
            const original = message(candidate.text);
            if (original !== undefined) replace(candidate, JSON.stringify(original));
          } else if (ts.isConditionalExpression(candidate)) {
            resolve(candidate.whenTrue); resolve(candidate.whenFalse);
          } else if (ts.isJsxExpression(candidate) && candidate.expression) {
            resolve(candidate.expression);
          } else if (ts.isBinaryExpression(candidate)) {
            resolve(candidate.right);
          }
        }
        resolve(node.initializer);
      }
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)
      && ["label", "buttonLabel", "hint"].includes(node.name.text) && ts.isStringLiteral(node.initializer)) {
      const original = message(node.initializer.text);
      if (original !== undefined) replace(node.initializer, JSON.stringify(original));
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [id, values] = node.arguments;
      const name = node.expression.text;
      if (id && name === "uiLabel" && node.arguments.length === 1) {
        changes.push({ start: node.getStart(tree), end: id.getStart(tree), value: "" });
        changes.push({ start: id.end, end: node.end, value: "" });
      } else if (id && ts.isStringLiteral(id)) {
        const original = name === "apiMessage" ? message("errors." + id.text)
          : name === "text" ? message(id.text) : undefined;
        if (original !== undefined) {
          if (values && ts.isObjectLiteralExpression(values)) {
            replace(node, originalTemplate(original, values, tree));
            return;
          }
          if (!values) {
            const parent = node.parent;
            const attribute = ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) ? parent : node;
            replace(attribute, JSON.stringify(original));
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let result = source;
  for (const { start, end, value } of changes.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + value + result.slice(end);
  }
  cache.set(file, result);
  return result;
}
