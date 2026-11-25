import { notFound, redirect } from "next/navigation";
import CanvasEditorPage from "@/components/canvas/CanvasEditorPage";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CanvasEditorRoute({ params, searchParams }: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const publicId = /^[0-9a-f]{32}$/i.test(params.id) ? params.id.toLowerCase() : null;
  const legacyId = /^[1-9]\d*$/.test(params.id) ? Number(params.id) : 0;
  if (!publicId && (!Number.isInteger(legacyId) || legacyId < 1 || legacyId > 2147483647)) notFound();

  const canvas = await prisma.canvas.findFirst({
    where: { ...(publicId ? { publicId } : { id: legacyId }), deletedAt: null, data: { path: ["mode"], equals: "smart" } },
    select: { id: true, publicId: true },
  });
  if (!canvas) notFound();
  if (params.id !== canvas.publicId) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (Array.isArray(value)) value.forEach(item => query.append(key, item));
      else if (value !== undefined) query.set(key, value);
    }
    const suffix = query.toString();
    redirect(`/canvas/${canvas.publicId}${suffix ? `?${suffix}` : ""}`);
  }
  return <CanvasEditorPage canvasId={canvas.id} />;
}
