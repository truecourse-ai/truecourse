import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  transpilePackages: ['@truecourse/shared'],
  devIndicators: false,
};

export default nextConfig;
