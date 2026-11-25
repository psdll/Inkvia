import { NextResponse } from "next/server";
import { getToolboxModelDisplayNames } from "@/lib/image-edit-models";

export const dynamic = "force-dynamic";

export async function GET() {
  // Include hidden models so existing results retain their configured display names.
  return NextResponse.json({ displayNames: await getToolboxModelDisplayNames() });
}
