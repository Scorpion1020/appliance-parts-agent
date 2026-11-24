/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev }) {
    if (dev) {
      // WSL 挂载盘可能丢失文件变更事件，轮询确保运行代码与工作区一致。
      config.watchOptions = { ...config.watchOptions, poll: 1000, aggregateTimeout: 300 };
      // Avoid stale .next/cache webpack pack files interrupting local demos after cache cleanup.
      config.cache = false;
    }

    return config;
  }
};

export default nextConfig;
