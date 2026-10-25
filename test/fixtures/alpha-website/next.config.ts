import { withPayload } from "@payloadcms/next/withPayload";
import type { NextConfig } from "next";

// Canonical production hosts. Used to detect whether this deploy is the real
// public site, independently of APP_ENV — historically a missing APP_ENV on
// App Runner silently de-indexed prod via X-Robots-Tag.
const PROD_HOSTS = new Set(["www.alphacompute.ai", "alphacompute.ai"]);
const CANONICAL_HOST = "www.alphacompute.ai";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.alphacompute.ai"
).replace(/\/$/, "");
let siteHost = "";
try {
  siteHost = new URL(siteUrl).host;
} catch {
  siteHost = "";
}

// Optional CDN host for media (see MEDIA_CDN_URL in payload.config.ts). When
// set, next/image must be allowed to optimise from it, so derive the host and
// add it to remotePatterns below.
let mediaCdnHost = "";
try {
  const raw = process.env.MEDIA_CDN_URL;
  if (raw) mediaCdnHost = new URL(raw).host;
} catch {
  mediaCdnHost = "";
}

const isProductionEnv = process.env.APP_ENV === "production";
const isProductionHost = PROD_HOSTS.has(siteHost);
const isProductionDeploy = isProductionEnv || isProductionHost;

if (isProductionHost && !isProductionEnv) {
  // Surface the misconfiguration loudly in build/server logs so the env can
  // be corrected — but do NOT emit the noindex header (the host check is the
  // ultimate authority for whether this is the public site).
  console.warn(
    `[next.config] NEXT_PUBLIC_SITE_URL points to production host "${siteHost}" but APP_ENV is "${process.env.APP_ENV ?? "<unset>"}". Treating as production for indexing purposes. Set APP_ENV=production to silence this warning.`,
  );
}

const nextConfig: NextConfig = {
  // Required for the Docker build that App Runner serves — produces a minimal
  // server bundle under .next/standalone with its own copy of node_modules.
  output: "standalone",

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
    deviceSizes: [360, 640, 750, 828, 1080, 1200, 1440, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      { protocol: "https", hostname: "**.s3.us-east-2.amazonaws.com" },
      ...(mediaCdnHost
        ? [{ protocol: "https" as const, hostname: mediaCdnHost }]
        : []),
    ],
  },
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // Tighten tree-shaking on barrel-export libraries so only the icons/motion
  // primitives actually used are bundled (cuts initial JS without code changes).
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },

  // Multiple root layouts ((site) and (payload) each serve as their own root).
  // We deliberately do NOT enable experimental.globalNotFound: in the deployed
  // App Runner build it injected a not-found parallel-route boundary into the
  // RSC flight that the (byte-identical) client bundle then failed to reconcile
  // on /admin/login, blanking the Payload admin via a silent hydration bail.
  // Not-found UX is handled per route-group by (site)/not-found.tsx and
  // (payload)/admin/[[...segments]]/not-found.tsx instead.

  async redirects() {
    // Apex → www 301. Both hostnames currently resolve to the same App Runner
    // service; without this redirect, og:url / canonical and the browser
    // address bar disagree, and link equity splits across two origins.
    // Only emit on production deploys so local dev (localhost) and staging
    // hosts aren't affected.
    // /news was folded into /newsroom; keep old links and indexed URLs working.
    const moved = [
      { source: "/news", destination: "/newsroom", permanent: true },
      { source: "/news/:slug", destination: "/newsroom/:slug", permanent: true },
      // GPUaaS became Compute, and its inventory a top-level page (301s).
      { source: "/gpuaas", destination: "/compute", statusCode: 301 },
      { source: "/gpuaas/inventory", destination: "/inventory", statusCode: 301 },
    ];
    if (!isProductionDeploy) return moved;
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "alphacompute.ai" }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      ...moved,
    ];
  },

  async rewrites() {
    return {
      // beforeFiles runs before the filesystem (including metadata routes like
      // robots.ts), so this intercepts /robots.txt and serves the custom
      // handler that includes Content-Signal directives.
      beforeFiles: [
        { source: "/robots.txt", destination: "/api/robots-txt" },
        {
          source: "/.well-known/oauth-protected-resource",
          destination: "/api/well-known/oauth-protected-resource",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  async headers() {
    // RFC 8288 Link header value — advertises agent-discovery endpoints.
    const agentLink = [
      '</.well-known/api-catalog>; rel="api-catalog"',
      '</.well-known/mcp/server-card.json>; rel="service-desc"',
      '</.well-known/agent-skills/index.json>; rel="service-doc"',
    ].join(", ");

    // Block indexing on non-production deployments. APP_ENV is set per
    // environment by App Runner ("production" on prod, "staging" on staging,
    // undefined locally). Staging serves canonical-looking URLs so without
    // this it'd risk being indexed alongside prod.
    //
    // Belt-and-suspenders: we also treat any deploy whose canonical
    // NEXT_PUBLIC_SITE_URL is the production host as production, even if
    // APP_ENV is missing — a missing APP_ENV on App Runner previously
    // de-indexed the live site silently.
    const noIndexHeaders = isProductionDeploy
      ? []
      : [
          {
            source: "/:path*",
            headers: [
              { key: "X-Robots-Tag", value: "noindex, nofollow" },
            ],
          },
        ];

    return [
      ...noIndexHeaders,
      // HTML pages must not be cached so reviewers always get the latest deploy.
      // Also ship baseline security headers. A tight CSP is intentionally omitted
      // here — this site loads media CDNs, Payload admin, and WebGL assets that
      // need a separate CSP audit; connect-src 'self' alone would break them.
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, must-revalidate",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // SAMEORIGIN (not DENY) so Payload's admin Live Preview can embed
            // site pages in an iframe — admin and site are the same origin.
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
        ],
      },
      // Static asset long-cache (overrides the above for hashed files)
      {
        source: "/:path(team|videos|images|fonts|media)/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Media originals streamed through the Payload proxy. The CDN otherwise
      // applies a short default TTL (the ~4h Cloudflare browser-cache default
      // observed in prod), forcing the image optimizer to re-fetch the source
      // on every cold encode. Send an explicit long TTL from the origin so the
      // edge and browsers hold these. Once MEDIA_CDN_URL is set these proxy
      // URLs are bypassed entirely and the CDN's own cache policy governs.
      // NOTE: the edge can still override origin Cache-Control — the
      // authoritative long-TTL lever is a Cloudflare cache rule (infra).
      {
        source: "/api/media/file/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
      // RFC 8288 Link headers on main HTML pages so agents find discovery docs
      { source: "/", headers: [{ key: "Link", value: agentLink }] },
      { source: "/investors", headers: [{ key: "Link", value: agentLink }] },
      // Extensionless well-known files need explicit Content-Type headers
      {
        source: "/.well-known/api-catalog",
        headers: [{ key: "Content-Type", value: "application/linkset+json" }],
      },
      {
        source: "/.well-known/oauth-authorization-server",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/openid-configuration",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/oauth-protected-resource",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/security.txt",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
      // MCP + agent-skills served from public/ — allow cross-origin reads
      {
        source: "/.well-known/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default withPayload(nextConfig);
