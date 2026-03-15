import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === '1' ? 'export' : undefined,
  transpilePackages: ['@truecourse/shared'],
  devIndicators: false,
};

export default nextConfig;
