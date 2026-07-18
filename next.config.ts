import type { NextConfig } from "next";
import path from "path";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disable the service worker in development to avoid caching headaches.
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  webpack: (config) => {
    // The @point-of-sale driver packages ship a malformed `exports` field
    // (only a `browser` condition, no "." subpath), so webpack can't resolve
    // the bare specifiers. Point straight at their ESM bundles instead.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@point-of-sale/webbluetooth-receipt-printer": path.resolve(
        __dirname,
        "node_modules/@point-of-sale/webbluetooth-receipt-printer/dist/webbluetooth-receipt-printer.esm.js"
      ),
      "@point-of-sale/webusb-receipt-printer": path.resolve(
        __dirname,
        "node_modules/@point-of-sale/webusb-receipt-printer/dist/webusb-receipt-printer.esm.js"
      ),
    };
    return config;
  },
};

export default withSerwist(nextConfig);
