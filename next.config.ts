import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Required for the multi-stage Docker build (copies only the minimal runtime)
  output: "standalone",
};
export default nextConfig;
