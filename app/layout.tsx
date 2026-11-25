import type { Metadata } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { UiLocaleProvider } from "@/i18n/ui";
import { normalizeUiLocale } from "@/i18n/locale";
import "./fonts/inter.css";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { ClientPreferences } from "@/components/system/client-preferences";
import { GlobalNoticeBanner } from "@/components/system/global-notice-banner";
import { ServiceWorkerRegistration } from "@/components/system/service-worker-registration";
import { AuthProvider } from '@/components/auth/AuthProvider'
import LoginModal from '@/components/auth/LoginModal'
import { AppQueryClientProvider } from '@/components/system/query-client-provider'


export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t.raw("pageTitle"), description: t.raw("pageDescription"), icons: { icon: "/favicon.png" } };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var storedTheme = localStorage.getItem('app-theme') || localStorage.getItem('settings_theme_v1') || 'dark';
                var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                var t = storedTheme === 'system' ? (prefersDark ? 'dark' : 'light') : (storedTheme === 'dark' ? 'dark' : 'light');
                var storedValue = storedTheme === 'system' ? 'system' : t;
                localStorage.setItem('app-theme', storedValue);
                localStorage.setItem('settings_theme_v1', storedValue);
                document.documentElement.setAttribute('data-theme', t);
                document.documentElement.classList.toggle('dark', t !== 'light');
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans bg-[var(--app-bg)] text-[var(--app-muted)] h-screen min-h-0 overflow-hidden flex">
        <UiLocaleProvider locale={normalizeUiLocale(locale)} messages={messages}>
        <AppQueryClientProvider>
          <AuthProvider>
            <ClientPreferences />
            <ServiceWorkerRegistration />
            <GlobalNoticeBanner />
            <AppShell>
              {children}
            </AppShell>
            <LoginModal />
          </AuthProvider>
        </AppQueryClientProvider>
        </UiLocaleProvider>
      </body>
    </html>
  );
}
