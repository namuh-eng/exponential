/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    if (process.env.EXPONENTIAL_HEADLESS_DIRECT_API_REWRITE === "false") {
      return [];
    }

    const apiUrl = process.env.EXPONENTIAL_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      return [];
    }

    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiUrl}/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
