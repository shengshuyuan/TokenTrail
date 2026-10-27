/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
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
