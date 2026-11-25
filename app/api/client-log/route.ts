import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Logger } from "@/lib/logger";
import { getCurrentUser } from "@/lib/server-auth";

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return NextResponse.json({ success: true, skipped: "unauthenticated" });
    }

    const body = await req.json();
    const { action, message, metadata } = body;

    if (!action || !message) {
      return NextResponse.json(
        { success: false, error: apiMessage("mbf7f12b5c6ec") },
        { status: 400 }
      );
    }

    const reqInfo = Logger.extractRequestInfo(req);

    await Logger.log({
      userId: String(currentUser.id),
      category: "user_action",
      action,
      level: "info",
      message,
      metadata,
      ...reqInfo,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to log client action:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error.message) },
      { status: 500 }
    );
  }
}
