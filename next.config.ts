import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    // A stray package-lock.json in the user's home directory would otherwise be picked as the root.
    root: import.meta.dirname,
  },
};

export default nextConfig;
