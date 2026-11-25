import "server-only";

import { canvasEditorSessionKey, parseCanvasEditorSessionRecord } from "@/lib/canvas/editor-session";

type CanvasEditorSessionDb = {
  appSetting: {
    findUnique(input: { where: { key: string }; select: { value: true } }): Promise<{ value: string } | null>;
  };
};

export async function canvasEditorSessionMatches(
  db: CanvasEditorSessionDb,
  input: { authUserId: number; canvasId: number; sessionId: string },
) {
  const presented = input.sessionId.trim();
  if (!presented) return false;
  const row = await db.appSetting.findUnique({
    where: { key: canvasEditorSessionKey(input.authUserId, input.canvasId) },
    select: { value: true },
  });
  const record = parseCanvasEditorSessionRecord(row?.value);
  return record?.sessionId === presented && Date.parse(record.expiresAt) > Date.now();
}
