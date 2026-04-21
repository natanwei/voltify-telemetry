import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow Node-style ESM `.js` imports to resolve to `.ts` sources, so the
  // dashboard can share imports (e.g. `../../shared/ddb.js`) with the
  // Node-only scripts (simulator, worker, infra) that actually run under tsx.
  webpack: config => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default nextConfig
