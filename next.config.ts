import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.220"],
  // Sharp's dynamically loaded libvips library must travel with this function.
  // Otherwise Vercel can build successfully but fail when a report is submitted.
  outputFileTracingIncludes: {
    "/api/support/reports": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
  // AT CAPACITY app sign up page (/join) lives in its own Vercel project,
  // atcapacity-app-join. Served here so the public address is app.onlinegordy.com/join.
  // The page asks for /style.css, /config.js and /site.js at the root; those are
  // fallback rewrites so they only apply when this app has no file or route of that name.
  async rewrites() {
    const JOIN = "https://atcapacity-app-join.vercel.app";
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/join", destination: `${JOIN}/join` },
        { source: "/join/:path*", destination: `${JOIN}/join/:path*` },
      ],
      fallback: [
        { source: "/style.css", destination: `${JOIN}/style.css` },
        { source: "/config.js", destination: `${JOIN}/config.js` },
        { source: "/site.js", destination: `${JOIN}/site.js` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/auth/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "strict-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
