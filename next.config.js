/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14.x: experimental.serverComponentsExternalPackages
  // Next.js 15.x: 顶层 serverExternalPackages
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  generateBuildId: async () => 'tokentrail-' + Date.now(),
}

module.exports = nextConfig
