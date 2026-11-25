import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /^Inkvia-v\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REPORT_KEYS = [
  "artifactSha256",
  "gitCommit",
  "migrationSetSha256",
  "newVersion",
  "oldCodeReadOnlyProbePassed",
  "oldVersion",
  "sourceDatabaseSha256",
].sort();

const sameKeys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);

const assertUpgradeFrom = (upgradeFrom) => {
  if (!Array.isArray(upgradeFrom) || upgradeFrom.length === 0)
    throw new Error("At least one --upgrade-from version is required");
  if (upgradeFrom.some((value) => !VERSION_PATTERN.test(value)))
    throw new Error("Invalid upgrade-from version");
  if (new Set(upgradeFrom).size !== upgradeFrom.length)
    throw new Error("Duplicate upgrade-from version");
};

export const validateCompatibilityReport = ({
  report,
  upgradeFrom,
  newVersion,
  gitCommit,
  artifactSha256,
}) => {
  assertUpgradeFrom(upgradeFrom);
  if (!VERSION_PATTERN.test(newVersion))
    throw new Error("Invalid expected new version");
  if (!GIT_COMMIT_PATTERN.test(gitCommit))
    throw new Error("Invalid expected git commit");
  if (!SHA256_PATTERN.test(artifactSha256))
    throw new Error("Invalid expected artifact SHA-256");
  if (!sameKeys(report, REPORT_KEYS))
    throw new Error("Invalid compatibility report fields");
  if (!VERSION_PATTERN.test(report.oldVersion))
    throw new Error("Invalid compatibility report old version");
  if (!upgradeFrom.includes(report.oldVersion))
    throw new Error("Compatibility report old version is not in upgradeFrom");
  if (report.newVersion !== newVersion)
    throw new Error("Compatibility report new version mismatch");
  if (report.gitCommit !== gitCommit)
    throw new Error("Compatibility report git commit mismatch");
  if (report.artifactSha256 !== artifactSha256)
    throw new Error("Compatibility report artifact SHA-256 mismatch");
  if (!SHA256_PATTERN.test(report.migrationSetSha256))
    throw new Error("Invalid compatibility report migration-set SHA-256");
  if (!SHA256_PATTERN.test(report.sourceDatabaseSha256))
    throw new Error("Invalid compatibility report source-database SHA-256");
  if (report.oldCodeReadOnlyProbePassed !== true)
    throw new Error(
      "Compatibility report old-code read-only probe did not pass",
    );
  return report;
};

export const readAndValidateCompatibilityReport = ({
  reportFile,
  ...binding
}) => {
  let bytes;
  try {
    bytes = readFileSync(reportFile);
  } catch {
    throw new Error("Compatibility report is unreadable");
  }
  let report;
  try {
    report = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid compatibility report JSON");
  }
  validateCompatibilityReport({ report, ...binding });
  return { bytes, report };
};

const parseOptions = (arguments_) => {
  const singletons = new Set([
    "--report",
    "--new-version",
    "--git-commit",
    "--artifact-sha256",
  ]);
  const options = {};
  const upgradeFrom = [];
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    if (!singletons.has(option) && option !== "--upgrade-from")
      throw new Error(`Unknown option: ${option || "<empty>"}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${option}`);
    if (option === "--upgrade-from") {
      upgradeFrom.push(value);
      continue;
    }
    if (Object.hasOwn(options, option))
      throw new Error(`Duplicate option: ${option}`);
    options[option] = value;
  }
  for (const option of singletons) {
    if (!options[option]) throw new Error(`Required option: ${option}`);
  }
  assertUpgradeFrom(upgradeFrom);
  return {
    reportFile: options["--report"],
    newVersion: options["--new-version"],
    gitCommit: options["--git-commit"],
    artifactSha256: options["--artifact-sha256"],
    upgradeFrom,
  };
};

const runCli = () => {
  try {
    const options = parseOptions(process.argv.slice(2));
    readAndValidateCompatibilityReport(options);
    process.stdout.write(
      `Validated compatibility report: ${path.resolve(options.reportFile)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  runCli();
