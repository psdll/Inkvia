import prisma from "@/lib/prisma";
import type { AlertAcknowledgement } from "@/lib/monitoring/fault-guidance";

const ACKNOWLEDGEMENT_PREFIX = "monitoring.alert.ack.";

export function normalizeAlertFingerprint(value: unknown) {
  const fingerprint = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{8,64}$/.test(fingerprint)) throw new Error("告警编号无效");
  return fingerprint;
}

export async function readAlertAcknowledgements() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: ACKNOWLEDGEMENT_PREFIX } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return Object.fromEntries(rows.flatMap((row) => {
    const fingerprint = row.key.slice(ACKNOWLEDGEMENT_PREFIX.length);
    try {
      const parsed = JSON.parse(row.value) as AlertAcknowledgement;
      if (!parsed?.by || !parsed?.at) return [];
      return [[fingerprint, parsed]];
    } catch {
      return [];
    }
  }));
}

export async function acknowledgeAlert(input: {
  fingerprint: string;
  by: string;
  note?: string;
  at?: Date;
}) {
  const fingerprint = normalizeAlertFingerprint(input.fingerprint);
  const acknowledgement: AlertAcknowledgement = {
    by: String(input.by || "admin").slice(0, 120),
    at: (input.at || new Date()).toISOString(),
    note: String(input.note || "").trim().slice(0, 500) || undefined,
  };
  await prisma.appSetting.upsert({
    where: { key: `${ACKNOWLEDGEMENT_PREFIX}${fingerprint}` },
    create: {
      key: `${ACKNOWLEDGEMENT_PREFIX}${fingerprint}`,
      value: JSON.stringify(acknowledgement),
    },
    update: { value: JSON.stringify(acknowledgement) },
  });
  return acknowledgement;
}
