import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  experimental: {
    useCache: true
  },
  turbopack: {
    root: dirname
  }
};

export default nextConfig;
