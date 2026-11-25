import { NextRequest, NextResponse } from "next/server";
import { getVisibleToolboxModels, type ToolboxModelCategory } from "@/lib/image-edit-models";

export const dynamic = "force-dynamic";

const categories = new Set<ToolboxModelCategory>(["face", "image", "video"]);

export async function GET(req: NextRequest) {
  const rawCategory = req.nextUrl.searchParams.get("category");
  if (rawCategory === "face") return NextResponse.json({ success: true, models: [] });
  const category = categories.has(rawCategory as ToolboxModelCategory)
    ? (rawCategory as ToolboxModelCategory)
    : undefined;
  const models = await getVisibleToolboxModels(category);
  return NextResponse.json({ success: true, models });
}
