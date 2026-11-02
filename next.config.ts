import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ドメイン層は Node 22 でも直接実行できるよう、相対 import に .ts 拡張子を付けている
  experimental: {},
};

export default nextConfig;
