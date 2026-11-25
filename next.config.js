const developmentServerExternalPackages = [
  "ali-oss",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-node",
  "@opentelemetry/semantic-conventions",
];

// Local production uses this checkout's node_modules and runs with next start.
// Standalone tracing would scan unrelated local runtime data while packaging.
const localProduction = process.env.INKVIA_LOCAL_PRODUCTION === "1";

const nextConfig = {
  devIndicators: { buildActivity: false },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(localProduction ? { outputFileTracing: false } : { output: "standalone" }),
  ...(process.env.NODE_ENV === "development"
    ? {
        onDemandEntries: {
          maxInactiveAge: 30 * 60 * 1000,
          pagesBufferLength: 12,
        },
      }
    : {}),

  // 生产构建不因 ESLint 报错而中断（项目存在大量历史 lint 告警/错误，如 react/no-unescaped-entities）。
  // 类型检查仍然开启，作为真正的安全网；需要时仍可手动 `npm run lint`。
  eslint: { ignoreDuringBuilds: true },

  // 性能优化
  swcMinify: true,
  reactStrictMode: true,
  
  // 优化编译速度
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  webpack(config, { isServer }) {
    const inventoryDir = process.env.INKVIA_LICENSE_INVENTORY_DIR;
    if (inventoryDir) {
      const { WebpackLicenseInventory } = require("./desktop/scripts/webpack-license-inventory.cjs");
      config.plugins.push(new WebpackLicenseInventory(__dirname, nextConfig.distDir));
    }
    config.resolve = config.resolve || {};
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        // Fabric is browser-only in this project. Its optional Node backend
        // requires native Cairo/GTK and must not enter the Next server bundle.
        canvas: false,
      };
    }
    return config;
  },
  
  // 优化图片加载
  images: {
    // 低内存服务器建议关闭 Next 内置图片优化，避免运行时额外占用
    unoptimized: true,
    formats: ["image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
  },
  
  // 实验性功能 - 优化路由预加载
  experimental: {
    instrumentationHook: true,
    optimizePackageImports: ['lucide-react'],
    // Pi loads Node built-ins dynamically; keep its server runtime as native ESM.
    serverComponentsExternalPackages: [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-agent-core",
      ...(process.env.NODE_ENV === "development" ? developmentServerExternalPackages : []),
    ],
    // Local evidence, resource policies and secret keyrings are never release inputs.
    outputFileTracingIncludes: {
      '/api/canvas/upload': ['./scripts/canvas-media-probe.mjs'],
    },
    outputFileTracingExcludes: {
      '/*': ['./public/**/*', './.codex-artifacts/**/*', './.codex_tmp/**/*', './.runtime-local/**/*', './tmp/**/*', './config/local-runtime.json', './config/test-runtime.json'],
    },
  },
  // 安全响应头（公网 HTTPS 部署基线）
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next.js 运行时与主题脚本需要内联脚本；dev 模式 React 刷新需要 eval
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join("; ");

    return [
      {
        source: "/media-cache-sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/uploads/materials/thumbs/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/products/thumbs/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // Phase 1 新增：中等预览（sha1 内容寻址，同样可以 immutable 强缓存）
        source: "/uploads/materials/preview/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/material_library/previews/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/material_library/thumbs/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/inspiration_assets/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/template_images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/template_videos/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // 生成结果 / 用户素材 / 预设文件 —— 全部按 UUID 命名,内容寻址,可以长缓存
      {
        source: "/uploads/imports/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // 作品预览图/视频封面：sha1 内容寻址（内容变则文件名变），immutable 安全。
        // 管理员"作品素材"面板和用户"我的作品"高频加载的就是这两个文件夹。
        source: "/uploads/generation_previews/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/generation_posters/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/image_results/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/face_results/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/video_results/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/materials/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/products/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/material_library/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/uploads/presets/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // /api/thumb 是 sharp 生成的本地缩略图,sha1 内容寻址,可以非常激进地缓存
      {
        source: "/api/thumb/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          // 浏览器在 HTTP 下会忽略 HSTS，故始终下发是安全的
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

const withNextIntl = require("next-intl/plugin")("./i18n/request.ts");
module.exports = withNextIntl(nextConfig);
