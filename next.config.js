/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14.x: experimental.serverComponentsExternalPackages
  // Next.js 15.x: 顶层 serverExternalPackages
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  generateBuildId: async () => 'tokentrail-' + Date.now(),
  async rewrites() {
    return [
      {
        source: '/proxy/openai/:path*',
        destination: '/api/proxy/openai/:path*',
      },
      {
        source: '/proxy/openai-traework/:path*',
        destination: '/api/proxy/openai-traework/:path*',
      },
    ]
  },
}

module.exports = nextConfig
