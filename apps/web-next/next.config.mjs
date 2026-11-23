/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // شل وب فراخوانی‌های API را به سرور اصلی پروکسی می‌کند تا مسیر نسبی /api در مرورگر
  // همیشه کار کند (رفع خطای 404 سلام‌رسانی — گیت تست یکپارچهٔ موج ۳)
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
