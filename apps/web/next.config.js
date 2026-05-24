/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    if (process.env.EXPONENTIAL_HEADLESS_DIRECT_API_REWRITE === "false") {
      return [];
    }

    const apiUrl = process.env.EXPONENTIAL_API_URL;
    if (!apiUrl) {
      return [];
    }

    return {
      fallback: [
        {
          source: "/api/:path*",
          destination: `${apiUrl.replace(/\/$/, "")}/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
