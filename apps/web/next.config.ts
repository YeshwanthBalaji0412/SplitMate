import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@split-smart/types', '@split-smart/split-engine'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
