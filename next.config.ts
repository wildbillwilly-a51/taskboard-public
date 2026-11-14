import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Bearer URLs must not be printed by the development request logger.
  logging: { incomingRequests: { ignore: [/^\/share\/(?:task|note)\//] } },
};

export default nextConfig;
