const { createGuardedPrismaClient } = require("./lib/runtime-isolation.cjs");
const { PrismaClient } = require("@prisma/client");
const prisma = createGuardedPrismaClient();
(async () => {
  const u = await prisma.user.findFirst({
    where: { token: { not: null } },
    orderBy: { id: "desc" },
  });
  if (!u) {
    console.log("NO_USER");
    process.exit(0);
  }
  console.log(JSON.stringify({ id: u.id, username: u.username, token: u.token }));
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
