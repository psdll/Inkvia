import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, normalizeUiLocale } from "./locale";

export default getRequestConfig(async () => {
  const locale = normalizeUiLocale(cookies().get(LOCALE_COOKIE)?.value);
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
