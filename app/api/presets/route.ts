import { apiMessage } from "@/i18n/api-message";
import { GET as getUnifiedPromptPresets } from "@/app/api/prompt-presets/route";
import { promptJson } from "@/lib/prompt-presets/http";

export const runtime = "nodejs";

const UNIFIED_ENDPOINT = "/api/prompt-presets";

export async function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.delete("userId");
  url.searchParams.delete("scope");
  url.searchParams.delete("includeDeleted");
  url.pathname = UNIFIED_ENDPOINT;
  const response = await getUnifiedPromptPresets(
    new Request(url, {
      method: "GET",
      headers: req.headers,
    }),
  );
  response.headers.set("deprecation", "true");
  response.headers.set("x-replacement-endpoint", UNIFIED_ENDPOINT);
  return response;
}

export async function PUT(_req: Request) {
  return promptJson(
    {
      error: apiMessage("m099d6df628f7"),
      endpoint: UNIFIED_ENDPOINT,
    },
    410,
  );
}
