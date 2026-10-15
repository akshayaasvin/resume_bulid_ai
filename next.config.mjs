/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Don't reuse cached copies of dynamic pages on back/forward navigation, so counters such as
    // "1 of 3 tests done" are fresh right after a test (Next 14 otherwise caches them for 30 s).
    staleTimes: { dynamic: 0 },
    // sql.js loads its wasm from node_modules at runtime for server-side SQL grading;
    // @react-pdf/renderer is heavy and must not be bundled into server chunks.
    serverComponentsExternalPackages: ['sql.js', '@react-pdf/renderer'],
    outputFileTracingIncludes: {
      '/api/**/*': ['./node_modules/sql.js/dist/sql-wasm.wasm', './public/fonts/**/*'],
    },
  },
};
export default nextConfig;
