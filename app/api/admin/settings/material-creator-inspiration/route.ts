import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  getEnabledMaterialCreatorNames,
  normalizeCreatorPermissionName,
  setEnabledMaterialCreatorNames,
  uniqueCreatorPermissionNames,
} from "@/lib/material-creator-permissions";

export const dynamic = "force-dynamic";

async function readCreatorPermissions() {
  const [creatorRows, inspirationRows, enabledNames] = await Promise.all([
    prisma.materialAsset.groupBy({
      by: ["creatorName"],
      where: {
        isDeleted: false,
        creatorName: { not: null },
        NOT: { creatorName: "" },
      },
      _count: { _all: true },
      orderBy: { creatorName: "asc" },
    }),
    prisma.materialAsset.groupBy({
      by: ["creatorName"],
      where: {
        isDeleted: false,
        creatorName: { not: null },
        inspiration: { not: null },
        NOT: [{ creatorName: "" }, { inspiration: "" }],
      },
      _count: { _all: true },
    }),
    getEnabledMaterialCreatorNames(),
  ]);

  const creatorNames = uniqueCreatorPermissionNames(creatorRows.map((row) => row.creatorName));
  const users = creatorNames.length
    ? await prisma.user.findMany({
        where: { username: { in: creatorNames } },
        select: { username: true },
      })
    : [];
  const accountNames = new Set(users.map((user) => user.username));
  const inspirationCountByName = new Map(
    inspirationRows.map((row) => [
      normalizeCreatorPermissionName(row.creatorName),
      row._count._all,
    ])
  );

  const creators = creatorRows
    .map((row) => {
      const name = normalizeCreatorPermissionName(row.creatorName);
      if (!name) return null;
      const hasAccount = accountNames.has(name);
      return {
        name,
        assetCount: row._count._all,
        inspirationCount: inspirationCountByName.get(name) || 0,
        hasAccount,
        enabled: hasAccount && (enabledNames === null || enabledNames.has(name)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    creators,
    configured: enabledNames !== null,
    enabledCreators: creators.filter((row) => row.enabled).map((row) => row.name),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  try {
    const payload = await readCreatorPermissions();
    return NextResponse.json({ success: true, ...payload });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error?.message || apiMessage("mbc4688996645")) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  try {
    const json = (await req.json().catch(() => null)) as { enabledCreators?: unknown } | null;
    const requestedNames = Array.isArray(json?.enabledCreators)
      ? uniqueCreatorPermissionNames(json.enabledCreators)
      : [];

    const creatorRows = await prisma.materialAsset.findMany({
      where: {
        isDeleted: false,
        creatorName: { not: null },
        NOT: { creatorName: "" },
      },
      select: { creatorName: true },
      distinct: ["creatorName"],
    });
    const existingCreatorNames = new Set(uniqueCreatorPermissionNames(creatorRows.map((row) => row.creatorName)));
    await setEnabledMaterialCreatorNames(requestedNames.filter((name) => existingCreatorNames.has(name)));

    const payload = await readCreatorPermissions();
    return NextResponse.json({ success: true, ...payload });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error?.message || apiMessage("m0b9a63dbbac4")) }, { status: 500 });
  }
}
