import createNextIntlPlugin from "next-intl/plugin";
import { createRequire } from "node:module";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" }
];

let initOpenNextCloudflareForDev = null;
try {
  ({ initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare"));
} catch {
  // Optional during local installs before dependencies are present.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:locale(zh|en)/system",
        headers: noStoreHeaders
      },
      {
        source: "/:locale(zh|en)/system/:path*",
        headers: noStoreHeaders
      }
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version || "0.1.0"
  }
};

const config = withNextIntl(nextConfig);
if (process.env.NODE_ENV === "development" && typeof initOpenNextCloudflareForDev === "function") {
  initOpenNextCloudflareForDev();
}

export default config;
