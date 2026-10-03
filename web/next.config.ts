import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external — they can't be bundled by webpack/turbopack.
  serverExternalPackages: [
    "better-sqlite3",
    "sharp",
    "@node-rs/argon2",
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: false,
  async headers() {
    // Allow the app to be framed as a Telegram/Bale Mini App.
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://t.me https://web.telegram.org https://*.telegram.org https://*.bale.ai https://ble.ir",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
