import prisma from "@/lib/prisma";

export const ROLE_POSITIONING_VISIBILITY_KEY = "role_positioning_visible";

export async function getRolePositioningVisible(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { key: ROLE_POSITIONING_VISIBILITY_KEY },
  });
  return row?.value === "1";
}

export async function saveRolePositioningVisible(visible: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: ROLE_POSITIONING_VISIBILITY_KEY },
    create: {
      key: ROLE_POSITIONING_VISIBILITY_KEY,
      value: visible ? "1" : "0",
    },
    update: { value: visible ? "1" : "0" },
  });
}
