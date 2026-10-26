/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fractalbot/shared'],
  experimental: {
    // The dashboard reuses the bot's pure ornode decoders in ../src/lib.
    externalDir: true,
  },
  webpack: (config) => {
    // ../src uses NodeNext-style '.js' specifiers for '.ts' files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
