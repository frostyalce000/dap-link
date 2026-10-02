import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Product photos are resized in the browser before upload, so 4 MB is
    // generous. It also stays under Vercel's 4.5 MB request limit.
    serverActions: { bodySizeLimit: "4mb" },
  },
  images: {
    // Product photos are uploaded to Supabase Storage.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The microphone is the only device feature the app ever asks for.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
