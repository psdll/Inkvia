import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateCompatibilityReport } from "./validate-compatibility-report.mjs";

const bytewiseCompare = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

function maskedCharacter(character) {
  return character === "\n" || character === "\r" ? character : " ";
}

export function maskDollarQuotedBodies(sql) {
  const source = String(sql || "");
  let masked = "";
  let mode = "normal";
  let blockDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] || "";
    if (mode === "line-comment") {
      masked += character;
      if (character === "\n") mode = "normal";
      continue;
    }
    if (mode === "block-comment") {
      masked += character;
      if (character === "/" && next === "*") {
        masked += next;
        blockDepth += 1;
        index += 1;
      } else if (character === "*" && next === "/") {
        masked += next;
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) mode = "normal";
      }
      continue;
    }
    if (mode === "single-quote") {
      masked += character;
      if (character === "'" && next === "'") {
        masked += next;
        index += 1;
      } else if (character === "'") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "escape-string") {
      masked += character;
      if (character === "'" && next === "'") {
        masked += next;
        index += 1;
      } else if (character === "\\" && next) {
        masked += next;
        index += 1;
      } else if (character === "'") {
        mode = "normal";
      }
      continue;
    }
    if (mode === "double-quote") {
      masked += character;
      if (character === '"' && next === '"') {
        masked += next;
        index += 1;
      } else if (character === '"') {
        mode = "normal";
      }
      continue;
    }
    if (character === "-" && next === "-") {
      masked += "--";
      index += 1;
      mode = "line-comment";
    } else if (character === "/" && next === "*") {
      masked += "/*";
      index += 1;
      blockDepth = 1;
      mode = "block-comment";
    } else if (character === "'") {
      masked += character;
      mode = "single-quote";
    } else if (
      (character === "E" || character === "e")
      && next === "'"
      && !/[A-Za-z0-9_$]/.test(source[index - 1] || "")
    ) {
      masked += character + next;
      index += 1;
      mode = "escape-string";
    } else if (character === '"') {
      masked += character;
      mode = "double-quote";
    } else if (character === "$" && !/[A-Za-z0-9_$]/.test(source[index - 1] || "")) {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (!match) {
        masked += character;
        continue;
      }
      const tag = match[0];
      const closingIndex = source.indexOf(tag, index + tag.length);
      if (closingIndex < 0) {
        masked += tag;
        index += tag.length - 1;
        continue;
      }
      masked += " ".repeat(closingIndex + tag.length - index);
      index = closingIndex + tag.length - 1;
    } else {
      masked += character;
    }
  }
  return masked;
}

function scanSqlStatements(sql) {
  const source = String(sql || "");
  const statements = [];
  let raw = "";
  let structure = "";
  let commentless = "";
  let mode = "normal";
  let blockDepth = 0;
  let dollarTag = "";
  let hasDollarQuote = false;
  let unsupportedStringPrefix = false;

  const append = (text, structuralText = text, commentlessText = text) => {
    raw += text;
    structure += structuralText;
    commentless += commentlessText;
  };
  const appendMasked = (text, keepCommentless = true) => {
    let masked = "";
    for (const character of text) masked += maskedCharacter(character);
    append(text, masked, keepCommentless ? text : masked);
  };
  const finishStatement = () => {
    if (commentless.trim()) {
      statements.push({
        sql: raw.trim(),
        structure: structure.trim(),
        commentless: commentless.trim(),
        hasDollarQuote,
        unsupportedStringPrefix,
      });
    }
    raw = "";
    structure = "";
    commentless = "";
    hasDollarQuote = false;
    unsupportedStringPrefix = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] || "";

    if (mode === "line-comment") {
      appendMasked(character, false);
      if (character === "\n") mode = "normal";
      continue;
    }
    if (mode === "block-comment") {
      if (character === "/" && next === "*") {
        appendMasked("/*", false);
        blockDepth += 1;
        index += 1;
      } else if (character === "*" && next === "/") {
        appendMasked("*/", false);
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) mode = "normal";
      } else {
        appendMasked(character, false);
      }
      continue;
    }
    if (mode === "single-quote") {
      if (character === "'" && next === "'") {
        appendMasked("''");
        index += 1;
      } else {
        appendMasked(character);
        if (character === "'") mode = "normal";
      }
      continue;
    }
    if (mode === "escape-string") {
      if (character === "'" && next === "'") {
        appendMasked("''");
        index += 1;
      } else if (character === "\\" && next) {
        appendMasked(character + next);
        index += 1;
      } else {
        appendMasked(character);
        if (character === "'") mode = "normal";
      }
      continue;
    }
    if (mode === "double-quote") {
      append(character);
      if (character === '"' && next === '"') {
        append(next);
        index += 1;
      } else if (character === '"') {
        mode = "normal";
      }
      continue;
    }
    if (mode === "dollar-quote") {
      if (source.startsWith(dollarTag, index)) {
        appendMasked(dollarTag);
        index += dollarTag.length - 1;
        mode = "normal";
      } else {
        appendMasked(character);
      }
      continue;
    }

    if (character === "-" && next === "-") {
      appendMasked("--", false);
      index += 1;
      mode = "line-comment";
    } else if (character === "/" && next === "*") {
      appendMasked("/*", false);
      index += 1;
      blockDepth = 1;
      mode = "block-comment";
    } else if (
      (character === "E" || character === "e")
      && next === "'"
      && !/[A-Za-z0-9_$]/.test(source[index - 1] || "")
    ) {
      append(character);
      appendMasked(next);
      index += 1;
      mode = "escape-string";
    } else if (
      (character === "U" || character === "u")
      && next === "&"
      && source[index + 2] === "'"
      && !/[A-Za-z0-9_$]/.test(source[index - 1] || "")
    ) {
      append(character + next);
      appendMasked("'");
      index += 2;
      unsupportedStringPrefix = true;
      mode = "single-quote";
    } else if (character === "'") {
      appendMasked(character);
      mode = "single-quote";
    } else if (character === '"') {
      append(character);
      mode = "double-quote";
    } else if (character === "$" && !/[A-Za-z0-9_$]/.test(source[index - 1] || "")) {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        hasDollarQuote = true;
        appendMasked(dollarTag);
        index += dollarTag.length - 1;
        mode = "dollar-quote";
      } else {
        append(character);
      }
    } else if (character === ";") {
      finishStatement();
    } else {
      append(character);
    }
  }
  finishStatement();
  return statements;
}

function scanMigrationStatements(sql) {
  const originalStatements = scanSqlStatements(sql);
  const maskedStatements = scanSqlStatements(maskDollarQuotedBodies(sql));
  return originalStatements.map((statement, index) => ({
    ...statement,
    structure: maskedStatements[index]?.structure || "",
  }));
}

function stripSqlComments(sql) {
  return scanSqlStatements(sql).map((statement) => statement.commentless).join(";\n");
}

function migrationContentHash(sql) {
  return crypto.createHash("sha256")
    .update(String(sql || "").replace(/\r\n?/g, "\n"))
    .digest("hex");
}

function onlineIndexDefinitionHash(sql) {
  const canonical = stripSqlComments(sql).trim().replace(/\s+/g, " ").replace(/;$/, "");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

const SQL_IDENTIFIER = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED_IDENTIFIER = `${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER})?`;

function normalizedIdentifier(identifier) {
  const value = String(identifier || "").trim();
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/""/g, '"')
    : value.toLowerCase();
}

function relationIdentity(identifier) {
  const pattern = new RegExp(`^(${SQL_IDENTIFIER})(?:\\s*\\.\\s*(${SQL_IDENTIFIER}))?$`);
  const match = String(identifier || "").trim().match(pattern);
  if (!match) return null;
  const schema = match[2] ? normalizedIdentifier(match[1]) : "public";
  const table = normalizedIdentifier(match[2] || match[1]);
  return { schema, table, key: JSON.stringify([schema, table]) };
}

function policyTableIdentity(table) {
  return JSON.stringify(["public", String(table)]);
}

function findClosingParenthesis(value) {
  let depth = 0;
  let quotedIdentifier = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1] || "";
    if (quotedIdentifier) {
      if (character === '"' && next === '"') {
        index += 1;
      } else if (character === '"') {
        quotedIdentifier = false;
      }
    } else if (character === '"') {
      quotedIdentifier = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCreateTable(statement) {
  const structure = String(statement?.structure || "");
  if (!/^CREATE\s+TABLE\b/i.test(structure)) return null;
  const pattern = new RegExp(
    `^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED_IDENTIFIER})(?=\\s|\\(|$)`,
    "i",
  );
  const match = structure.match(pattern);
  if (!match) return { supported: false, dataProducing: false, identity: null, conditional: false };
  const identity = relationIdentity(match[2]);
  let remainder = structure.slice(match[0].length).trim();
  let hasColumnDefinition = false;
  if (!identity) return { supported: false, dataProducing: false, identity: null, conditional: Boolean(match[1]) };
  if (remainder.startsWith("(")) {
    hasColumnDefinition = true;
    const closing = findClosingParenthesis(remainder);
    if (closing < 0) {
      return { supported: false, dataProducing: false, identity, conditional: Boolean(match[1]) };
    }
    remainder = remainder.slice(closing + 1).trim();
  }
  if (/^AS\b/i.test(remainder)) {
    return { supported: true, dataProducing: true, identity, conditional: Boolean(match[1]) };
  }
  return {
    supported: hasColumnDefinition && remainder === "",
    dataProducing: false,
    identity,
    conditional: Boolean(match[1]),
  };
}

function parseCreatedTables(statements) {
  const tables = [];
  for (const statement of statements) {
    const parsed = parseCreateTable(statement);
    if (parsed?.supported && !parsed.dataProducing && !parsed.conditional) tables.push(parsed.identity);
  }
  return tables;
}

function parseAlteredTable(statement) {
  const pattern = new RegExp(
    `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED_IDENTIFIER})(?=\\s|$)`,
    "i",
  );
  const match = String(statement?.structure || "").match(pattern);
  return match ? relationIdentity(match[1]) : null;
}

function containsExecutableSchema(statements) {
  return statements.some((statement) =>
    /^(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|CREATE\s+TRIGGER)\b/i.test(statement.structure),
  );
}

function parseIndexes(statement) {
  const pattern = new RegExp(
    `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED_IDENTIFIER})\\s+ON\\s+(?:ONLY\\s+)?(${QUALIFIED_IDENTIFIER})(?=\\s|\\(|$)`,
    "i",
  );
  const match = String(statement?.structure || "").match(pattern);
  if (!match) return [];
  const indexIdentity = relationIdentity(match[2]);
  const tableIdentity = relationIdentity(match[3]);
  if (!indexIdentity || !tableIdentity) return [];
  return [{
    concurrently: Boolean(match[1]),
    index: indexIdentity.table,
    table: tableIdentity.table,
    tableIdentity: tableIdentity.key,
  }];
}

function containsDestructiveSql(statements) {
  return Boolean(destructiveSqlOperation(statements));
}

function destructiveSqlOperation(statements) {
  const patterns = [
    ["DROP", /^(?:DROP\s+(?:TABLE|TYPE|SCHEMA|INDEX|VIEW)\b|ALTER\s+TABLE[\s\S]*?\bDROP\s+(?:COLUMN|CONSTRAINT)\b)/i],
    ["TRUNCATE", /^TRUNCATE(?:\s+TABLE)?\b/i],
    ["DELETE", /^DELETE\s+FROM\b/i],
    ["RENAME", /^ALTER\s+TABLE[\s\S]*?\bRENAME\b/i],
    ["ALTER COLUMN TYPE", /^ALTER\s+TABLE[\s\S]*?\bALTER\s+COLUMN[\s\S]*?\bTYPE\b/i],
    ["RENAME", /^RENAME\s+(?:COLUMN|TABLE)\b/i],
  ];
  for (const statement of statements) {
    const normalized = statement.structure.trim();
    const operation = patterns.find(([, pattern]) => pattern.test(normalized))?.[0];
    if (operation) return operation;
  }
  return null;
}

function isApprovedConstraintReplacement(migration, approvedSchemaMigrations) {
  if (
    approvedSchemaMigrations.get(String(migration.name))
    !== migrationContentHash(migration.sql)
  ) {
    return false;
  }

  const alterPrefix = `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED_IDENTIFIER})`;
  const dropPattern = new RegExp(
    `${alterPrefix}\\s+DROP\\s+CONSTRAINT\\s+(${SQL_IDENTIFIER})$`,
    "i",
  );
  const addPattern = new RegExp(
    `${alterPrefix}\\s+ADD\\s+CONSTRAINT\\s+(${SQL_IDENTIFIER})\\s+[\\s\\S]+$`,
    "i",
  );
  const dropped = new Map();
  const added = new Map();
  const record = (target, match) => {
    const table = relationIdentity(match[1]);
    if (!table) return false;
    const key = JSON.stringify([table.key, normalizedIdentifier(match[2])]);
    target.set(key, (target.get(key) || 0) + 1);
    return true;
  };

  for (const statement of migration.statements) {
    const normalized = statement.structure.trim();
    if (/^(?:BEGIN|COMMIT)$/i.test(normalized)) continue;
    if (
      /^SET\s+LOCAL\s+(?:lock_timeout|statement_timeout)\s*=\s*'\d+(?:ms|s|min)'$/i
        .test(statement.commentless.trim())
    ) {
      continue;
    }
    const dropMatch = normalized.match(dropPattern);
    if (dropMatch && record(dropped, dropMatch)) continue;
    const addMatch = normalized.match(addPattern);
    if (addMatch && record(added, addMatch)) continue;
    return false;
  }

  return dropped.size > 0
    && dropped.size === added.size
    && [...dropped].every(([key, count]) => added.get(key) === count);
}

const ADDITIVE_PATTERNS = [
  /^CREATE\s+TABLE\b/i,
  /^CREATE\s+TYPE\b/i,
  /^ALTER\s+TYPE\s+.+\s+ADD\s+VALUE\b/i,
  /^ALTER\s+TABLE\s+.+\s+ADD\s+COLUMN\b/i,
  /^ALTER\s+TABLE\s+.+\s+ADD\s+CONSTRAINT\b/i,
  /^ALTER\s+TABLE\s+.+\s+ALTER\s+COLUMN\s+.+\s+SET\s+DEFAULT\b/i,
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
  /^COMMENT\s+ON\b/i,
];

function validateAdditiveStatements(statements) {
  const errors = [];
  if (statements.some((statement) => statement.unsupportedStringPrefix)) {
    errors.push("unsupported PostgreSQL string prefix");
  }
  if (statements.some((statement) => statement.hasDollarQuote)) {
    errors.push("blocked dollar-quoted executable migration body");
    return errors;
  }
  for (const scanned of statements) {
    const statement = scanned.structure;
    const createTable = parseCreateTable(scanned);
    if (createTable?.dataProducing) {
      errors.push(`blocked data-producing CREATE TABLE statement: ${scanned.sql.slice(0, 80)}`);
      continue;
    }
    if (createTable && !createTable.supported) {
      errors.push(`unsupported CREATE TABLE statement: ${scanned.sql.slice(0, 80)}`);
      continue;
    }
    if (/^(?:DO|COPY|CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|UPDATE|INSERT|MERGE)\b/i.test(statement)) {
      errors.push(`blocked data mutation or executable migration statement: ${scanned.sql.slice(0, 80)}`);
      continue;
    }
    if (
      /^ALTER\s+TABLE\s+.+\s+ADD\s+COLUMN\b/i.test(statement)
      && /\bNOT\s+NULL\b/i.test(statement)
      && !/\bDEFAULT\b/i.test(statement)
    ) {
      errors.push(`NOT NULL added column requires a safe DEFAULT: ${scanned.sql.slice(0, 80)}`);
      continue;
    }
    if (!ADDITIVE_PATTERNS.some((pattern) => pattern.test(statement))) {
      errors.push(`unknown migration statement: ${scanned.sql.slice(0, 80)}`);
    }
  }
  return errors;
}

const DECLARATION_KEYS = [
  "class",
  "execution",
  "historicalRowWrites",
  "name",
  "oldCodeCompatible",
  "sha256",
];

function sameKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
  );
}

function validateMigrationDeclarations({
  policy,
  candidateMigrations,
  pendingMigrations,
  compatibilityReport,
  compatibilityBinding,
}) {
  const errors = [];
  const declarations = Array.isArray(policy?.migrations)
    ? policy.migrations
    : [];
  const candidates = Array.isArray(candidateMigrations)
    ? candidateMigrations
    : [];
  const candidateNames = candidates.map(({ name }) => String(name));
  const declarationNames = declarations.map(({ name }) => String(name || ""));
  const declarationCounts = new Map();
  for (const name of declarationNames) {
    declarationCounts.set(name, (declarationCounts.get(name) || 0) + 1);
  }
  for (const [name, count] of declarationCounts) {
    if (count > 1) errors.push(`duplicate migration declaration: ${name}`);
  }
  for (const name of candidateNames) {
    if (!declarationCounts.has(name))
      errors.push(`missing migration declaration: ${name}`);
  }
  for (const name of declarationNames) {
    if (!candidateNames.includes(name))
      errors.push(`extra migration declaration: ${name}`);
  }
  if (JSON.stringify(declarationNames) !== JSON.stringify(candidateNames)) {
    errors.push(
      "migration declarations must match bytewise-sorted candidate directories",
    );
  }

  const declarationsByName = new Map();
  for (const declaration of declarations) {
    const name = String(declaration?.name || "");
    if (!sameKeys(declaration, DECLARATION_KEYS)) {
      errors.push(
        `migration declaration fields must be exact for: ${name || "<empty>"}`,
      );
    }
    if (!["expand", "contract"].includes(declaration?.class)) {
      errors.push(`invalid migration class: ${name}`);
    }
    if (!["automatic", "manual"].includes(declaration?.execution)) {
      errors.push(`invalid migration execution: ${name}`);
    }
    if (typeof declaration?.historicalRowWrites !== "boolean") {
      errors.push(`historicalRowWrites must be boolean: ${name}`);
    }
    if (typeof declaration?.oldCodeCompatible !== "boolean") {
      errors.push(`oldCodeCompatible must be boolean: ${name}`);
    }
    if (
      declaration?.class === "contract" &&
      declaration?.execution === "automatic"
    ) {
      errors.push(`contract migration can never be automatic: ${name}`);
    }
    if (!declarationsByName.has(name))
      declarationsByName.set(name, declaration);
  }
  for (const candidate of candidates) {
    const name = String(candidate.name);
    const declaration = declarationsByName.get(name);
    if (
      declaration &&
      declaration.sha256 !== migrationContentHash(candidate.sql)
    ) {
      errors.push(`migration declaration hash mismatch: ${name}`);
    }
  }

  const pendingNames = new Set(
    (Array.isArray(pendingMigrations) ? pendingMigrations : []).map(
      ({ name }) => String(name),
    ),
  );
  for (const name of pendingNames) {
    const declaration = declarationsByName.get(name);
    if (!declaration) continue;
    if (
      declaration.class !== "expand" ||
      declaration.execution !== "automatic" ||
      declaration.historicalRowWrites !== false ||
      declaration.oldCodeCompatible !== true
    ) {
      errors.push(
        `pending migration must be expand/automatic/false/true: ${name}`,
      );
    }
  }

  const pendingEnumAddition = candidates.some(
    ({ name, sql }) =>
      pendingNames.has(String(name)) &&
      scanMigrationStatements(sql).some(({ structure }) =>
        /^ALTER\s+TYPE\s+.+\s+ADD\s+VALUE\b/i.test(structure),
      ),
  );
  if (pendingEnumAddition) {
    try {
      validateCompatibilityReport({
        report: compatibilityReport,
        ...(compatibilityBinding || {}),
      });
    } catch {
      errors.push(
        "pending enum addition requires a validated compatibility report with a passing old-code probe",
      );
    }
  }
  return errors;
}

/**
 * @param {{
 *   policy: any,
 *   pendingMigrations: Array<{name: string, sql: string}>,
 *   onlineIndexes: Array<{file: string, sql: string}>,
 *   candidateMigrations?: Array<{name: string, sql: string}>,
 *   compatibilityReport?: Record<string, any>,
 *   compatibilityBinding?: Record<string, any>,
 * }} options
 */
export function validateMigrationPolicy({
  policy,
  pendingMigrations,
  onlineIndexes,
  candidateMigrations,
  compatibilityReport,
  compatibilityBinding,
}) {
  const errors = [];
  const approved = new Map(
    (Array.isArray(policy?.approvedOnlineIndexes) ? policy.approvedOnlineIndexes : []).map((item) => [
      String(item.file),
      {
        table: String(item.table),
        index: String(item.index),
        sha256: String(item.sha256 || ""),
        databaseDefinition: String(item.databaseDefinition || ""),
      },
    ]),
  );
  const approvedSchemaMigrations = new Map(
    (Array.isArray(policy?.approvedSchemaMigrations) ? policy.approvedSchemaMigrations : [])
      .map((item) => [String(item.name), String(item.sha256 || "")]),
  );
  const largeTables = new Set(
    (Array.isArray(policy?.largeTables) ? policy.largeTables : []).map(policyTableIdentity),
  );
  const migrations = (Array.isArray(pendingMigrations) ? pendingMigrations : []).map((migration) => ({
    ...migration,
    statements: scanMigrationStatements(migration.sql),
  }));
  const pendingCreatedTables = new Set(
    migrations.flatMap((migration) => parseCreatedTables(migration.statements).map((table) => table.key)),
  );
  if (Number(policy?.version) !== 5)
    errors.push("migration policy version must be 5");
  if (Array.isArray(candidateMigrations)) {
    errors.push(
      ...validateMigrationDeclarations({
        policy,
        candidateMigrations,
        pendingMigrations,
        compatibilityReport,
        compatibilityBinding,
      }),
    );
  }

  for (const migration of migrations) {
    const approvedConstraintReplacement = isApprovedConstraintReplacement(
      migration,
      approvedSchemaMigrations,
    );
    const destructiveOperation = destructiveSqlOperation(migration.statements);
    if (destructiveOperation) {
      if (!policy?.allowDestructiveMigration && !approvedConstraintReplacement) {
        errors.push(destructiveOperation);
        errors.push(
          `destructive migration blocked (${destructiveOperation}): ${migration.name}`,
        );
      }
    }
    for (const statement of migration.statements) {
      const mutation = statement.structure.match(/^(INSERT|UPDATE|DELETE|MERGE)\b/i)?.[1]?.toUpperCase();
      if (mutation) {
        errors.push(`top-level ${mutation}`);
        errors.push(`top-level data mutation blocked: top-level ${mutation}: ${migration.name}`);
      }
    }

    if (containsExecutableSchema(migration.statements)) {
      if (approvedSchemaMigrations.get(String(migration.name)) !== migrationContentHash(migration.sql)) {
        errors.push(`blocked schema migration approval does not match name and SHA-256: ${migration.name}`);
      }
    } else if (!approvedConstraintReplacement) {
      for (const error of validateAdditiveStatements(migration.statements)) {
        errors.push(`${migration.name}: ${error}`);
      }
    }

    for (const statement of migration.statements) {
      for (const index of parseIndexes(statement)) {
        if (largeTables.has(index.tableIdentity) && !pendingCreatedTables.has(index.tableIdentity)) {
          errors.push(`large table index must run independently with CONCURRENTLY: ${migration.name}:${index.index}`);
        }
      }
    }
  }

  const acceptedOnlineIndexes = [];
  for (const entry of onlineIndexes || []) {
    const statements = scanSqlStatements(entry.sql);
    const statement = statements[0] || null;
    const indexes = parseIndexes(statement);
    const approval = approved.get(String(entry.file));
    if (
      statements.length !== 1
      || indexes.length !== 1
      || !indexes[0].concurrently
      || !/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\b/i.test(statement?.structure || "")
      || containsDestructiveSql(statements)
      || statements.some((item) => item.unsupportedStringPrefix)
      || /\b(?:INSERT\s+INTO|UPDATE\s+|CREATE\s+(?:TABLE|VIEW|TYPE|SCHEMA)|GRANT\s+|REVOKE\s+)\b/i.test(statement?.structure || "")
    ) {
      errors.push(`online index file must contain one CREATE INDEX CONCURRENTLY IF NOT EXISTS statement: ${entry.file}`);
      continue;
    }
    const index = indexes[0];
    if (!approval || approval.table !== index.table || approval.index !== index.index) {
      errors.push(`online index is not approved by migration-policy.json: ${entry.file}`);
      continue;
    }
    if (!approval.sha256 || approval.sha256 !== onlineIndexDefinitionHash(entry.sql)) {
      errors.push(`online index definition does not match approval: ${entry.file}`);
      continue;
    }
    if (
      !approval.databaseDefinition
      || !new RegExp(`CREATE (?:UNIQUE )?INDEX "${String(index.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(approval.databaseDefinition)
      || !approval.databaseDefinition.includes(`."${index.table}"`)
    ) {
      errors.push(`online index database definition is not approved: ${entry.file}`);
      continue;
    }
    acceptedOnlineIndexes.push(String(entry.file));
  }
  for (const file of approved.keys()) {
    if (!acceptedOnlineIndexes.includes(file)) errors.push(`approved online index file is missing: ${file}`);
  }
  const migrationInventory = migrations.map((migration) => ({
    name: String(migration.name),
    createdTables: parseCreatedTables(migration.statements).map(({ schema, table }) => ({ schema, table })),
  }));
  const createdTableKeys = migrationInventory.flatMap((migration) =>
    migration.createdTables.map(({ schema, table }) => JSON.stringify([schema, table])),
  );
  if (new Set(createdTableKeys).size !== createdTableKeys.length) {
    errors.push("pending migrations create a table more than once");
  }
  return { errors, onlineIndexes: acceptedOnlineIndexes, migrations: migrationInventory };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function runCli() {
  const root = path.resolve(arg("--app-root") || process.cwd());
  const policyPath = path.resolve(arg("--policy") || path.join(root, "config", "deploy", "migration-policy.json"));
  const appliedArg = arg("--applied");
  if (!appliedArg) throw new Error("Required option: --applied");
  const appliedPath = path.resolve(appliedArg);
  const migrationsRoot = path.resolve(arg("--migrations") || path.join(root, "prisma", "migrations"));
  const onlineRoot = path.resolve(arg("--online-indexes") || path.join(root, "config", "deploy", "online-indexes"));
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  let appliedBytes;
  try {
    const appliedStat = fs.statSync(appliedPath);
    if (!appliedStat.isFile()) throw new Error("not a file");
    appliedBytes = fs.readFileSync(appliedPath, "utf8");
  } catch {
    throw new Error("Applied migration history is unreadable");
  }
  const applied = appliedBytes
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (applied.length === 0) throw new Error("Applied migration history is empty");
  const migrationNames = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(bytewiseCompare);
  const appliedErrors = [];
  if (new Set(applied).size !== applied.length) {
    appliedErrors.push("applied migration list contains duplicate names");
  }
  const expectedAppliedPrefix = migrationNames.slice(0, applied.length);
  if (
    applied.length > migrationNames.length
    || applied.some((name, index) => name !== expectedAppliedPrefix[index])
  ) {
    appliedErrors.push("applied migrations are not the exact ordered migration-directory prefix");
  }
  const pendingNames = appliedErrors.length ? [] : migrationNames.slice(applied.length);
  const candidateMigrations = migrationNames.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(migrationsRoot, name, "migration.sql"), "utf8"),
  }));
  const pendingNameSet = new Set(pendingNames);
  const pendingMigrations = candidateMigrations.filter(({ name }) =>
    pendingNameSet.has(name),
  );
  const onlineIndexes = fs.existsSync(onlineRoot)
    ? fs.readdirSync(onlineRoot).filter((name) => name.endsWith(".sql")).sort().map((file) => ({
        file,
        sql: fs.readFileSync(path.join(onlineRoot, file), "utf8"),
      }))
    : [];
  let compatibilityReport;
  const compatibilityReportPath = arg("--compatibility-report");
  if (compatibilityReportPath) {
    try {
      compatibilityReport = JSON.parse(
        fs.readFileSync(path.resolve(compatibilityReportPath), "utf8"),
      );
    } catch {
      throw new Error("Compatibility report is unreadable or invalid");
    }
  }
  const result = validateMigrationPolicy({
    policy,
    pendingMigrations,
    onlineIndexes,
    candidateMigrations,
    compatibilityReport,
    compatibilityBinding: compatibilityReport
      ? {
          upgradeFrom: [arg("--upgrade-from")],
          newVersion: arg("--new-version"),
          gitCommit: arg("--git-commit"),
          artifactSha256: arg("--artifact-sha256"),
        }
      : undefined,
  });
  result.errors.push(...appliedErrors);
  process.stdout.write(`${JSON.stringify({ ...result, pending: pendingNames })}\n`);
  if (result.errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
