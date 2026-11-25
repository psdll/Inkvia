export function accountExportRecord(user: { id: number; username: string; createdAt: unknown; updatedAt: unknown } | null) {
  return user ? { id: user.id, username: user.username, createdAt: user.createdAt, updatedAt: user.updatedAt } : null;
}
