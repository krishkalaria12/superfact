import "@superfact/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  // mupdf ships a WebAssembly binary beside its JavaScript. Bundling it breaks the loader's
  // path resolution, so it is required from node_modules at runtime instead.
  serverExternalPackages: ["mupdf"],
};

export default nextConfig;
