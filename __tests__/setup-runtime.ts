// Unit tests must never inherit a developer's real connection or Prisma's .env fallback.
// Database integration jobs supply the separately provisioned test policy explicitly.
if (process.env.INKVIA_RUNTIME_PROFILE !== "test" || !process.env.INKVIA_RUNTIME_POLICY) {
  process.env.INKVIA_RUNTIME_PROFILE = "test";
  process.env.DATABASE_URL = "postgresql://unit_test:unused@127.0.0.1:1/disabled";
  delete process.env.INKVIA_RUNTIME_POLICY;
}
// Existing suites describe the Aliyun-OSS relay; platform hosting is covered by its own tests.
process.env.MEDIA_DELIVERY_MODE ??= "oss";
