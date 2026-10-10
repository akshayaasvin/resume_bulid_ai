/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // sql.js loads its wasm from node_modules at runtime for server-side SQL grading;
    // @react-pdf/renderer is heavy and must not be bundled into server chunks.
    serverComponentsExternalPackages: ['sql.js', '@react-pdf/renderer'],
    outputFileTracingIncludes: {
      '/api/**/*': ['./node_modules/sql.js/dist/sql-wasm.wasm', './public/fonts/**/*'],
    },
  },
};
export default nextConfig;
