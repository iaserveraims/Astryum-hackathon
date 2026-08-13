/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode
  reactStrictMode: true,
  
  
  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: 'api.astryum.com',
      },
      {
        protocol: 'https',
        hostname: 'assets.astryum.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
      // Add crypto logos and icons
      {
        protocol: 'https',
        hostname: 'cryptologos.cc',
      },
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },
  
  // Environment variables
  env: {
    NEXT_PUBLIC_APP_NAME: 'Astryum',
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || '1.0.0',
  },
  
  // Webpack configuration
  webpack: (config, { isServer, dev }) => {
    // Use in-memory cache in dev to avoid FS rename issues on Windows
    if (dev) {
      config.cache = { type: 'memory' };
    }

    // @metamask/sdk (pulled in transitively via @wagmi/connectors ->
    // @reown/appkit-adapter-wagmi) does an optional require of the React Native
    // async-storage package, which isn't installed in a web build. Resolve it to
    // an empty module on BOTH client and server bundles so the build doesn't fail.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    };

    // Server-side: replace browser-only packages with empty stubs.
    // These packages open WebSockets, HTTP connections, or use browser APIs at
    // module load time, hanging the Node.js event loop during page data collection.
    if (isServer) {
      const path = require('path');
      const stubPath = path.resolve(__dirname, './src/stubs/empty-module.js');

      // CSS subpath aliases must come FIRST (before their parent package alias)
      // because enhanced-resolve stops at the first match in insertion order.
      // All JS package aliases use $ (exact match) to avoid eating CSS subpaths.
      config.resolve.alias = {
        ...config.resolve.alias,
        // WalletConnect — heartbeat setInterval + WebSocket relay
        '@walletconnect/core$': stubPath,
        '@walletconnect/universal-provider$': stubPath,
        '@walletconnect/web3wallet$': stubPath,
        '@walletconnect/sign-client$': stubPath,
        '@walletconnect/utils$': stubPath,
        '@walletconnect/logger$': stubPath,
        '@reown/appkit$': stubPath,
        // Aptos SDK — loads node HTTP client (got) that creates persistent connections
        '@aptos-labs/ts-sdk$': stubPath,
        '@aptos-labs/aptos-client$': stubPath,
        '@aptos-labs/wallet-adapter-react$': stubPath,
        // XRPL — WebSocket client with reconnect timers
        'xrpl$': stubPath,
        'xumm$': stubPath,
        // Browser-only UI/chart libraries
        'recharts$': stubPath,
        // socket.io client — auto-connects on import
        'socket.io-client$': stubPath,
        // Coinbase Wallet SDK — browser extension API
        '@coinbase/wallet-sdk$': stubPath,
        // web3.js — uses browser globals
        'web3$': stubPath,
      };
    }
    // Add support for importing SVGs as React components
    config.module.rules.push({
      test: /\.svg$/,
      use: [
        {
          loader: '@svgr/webpack',
          options: {
            typescript: true,
            ext: 'tsx',
          },
        },
      ],
    });
    
    // Fallback for Node.js modules in client-side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        // REPARACIÓN: Configuración específica para Web3
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer'),
        util: require.resolve('util'),
        // Otros fallbacks existentes
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };

      // REPARACIÓN: Agregar ProvidePlugin para Web3
      const webpack = require('webpack');
      config.plugins = [
        ...config.plugins,
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
      ];
    }
    
    // Optimize bundle size in production
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks.cacheGroups,
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              chunks: 'all',
            },
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              enforce: true,
            },
          },
        },
      };
    }
    
    return config;
  },
  
  // Headers for security and performance
  async headers() {
    const securityHeaders = [
      {
        key: 'X-DNS-Prefetch-Control',
        value: 'on',
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // script-src: además de la app, los SDK de los proveedores de auth —
          //   challenges.cloudflare.com  → widget Turnstile (anti-bot)
          //   accounts.google.com        → Google Identity Services (login Google)
          //   appleid.cdn-apple.com      → Sign in with Apple JS
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com https://accounts.google.com https://appleid.cdn-apple.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' https: http: wss: ws:",
          // frame-src: los iframes que esos mismos SDK montan (reto del captcha,
          //   botón/one-tap de Google, popup de Apple). Sin esto el default-src
          //   'self' los bloquea y el widget no llega a renderizar.
          "frame-src 'self' https://challenges.cloudflare.com https://accounts.google.com https://appleid.apple.com",
          "media-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "upgrade-insecure-requests",
        ].join('; '),
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NODE_ENV === 'production'
              ? (process.env.NEXT_PUBLIC_APP_URL || 'https://app.astryum.com')
              : '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },
          {
            key: 'Access-Control-Max-Age',
            value: '86400',
          },
        ],
      },
      // Cache static assets
      {
        source: '/(.*)\\.(ico|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  
  // Redirects
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/app',
        permanent: true,
      },
      // Legacy routes
      {
        source: '/old-dashboard/:path*',
        destination: '/:path*',
        permanent: true,
      },
    ];
  },
  
  // Rewrites for API proxying
  async rewrites() {
    return {
      beforeFiles: [
        // API rewrites — apunta al backend (Railway/Render en prod, localhost en dev).
        // Se EXCLUYEN las rutas servidas por API routes locales de Next (el
        // backend de Express no las tiene; sin la exclusión este beforeFiles las
        // eclipsa y producción devuelve 404):
        //   · /api/xaman/*        → login XRPL (src/app/api/xaman/)
        //   · /api/access-gate    → gate de acceso pre-lanzamiento (src/app/api/access-gate/)
        {
          source: '/api/:path((?!(?:xaman|access-gate)(?:/|$)).*)',
          destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/:path`,
        },
      ],
      afterFiles: [
        {
          source: '/health',
          destination: '/api/health',
        },
      ],
      // fallback eliminado: el catch-all '/:path*' → '/' rompía el routing en Vercel
    };
  },

  // output: 'standalone' eliminado — Vercel gestiona el output internamente
  
  // Compression
  compress: true,
  
  // PoweredBy header
  poweredByHeader: false,
  
  // Trailing slash
  trailingSlash: false,
  
  // Generate ETags for caching
  generateEtags: true,
  
  // Abort static page generation after 30s instead of hanging forever
  staticPageGenerationTimeout: 30,

  // TypeScript configuration
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // ESLint configuration  
  eslint: {
    ignoreDuringBuilds: true,
    dirs: ['pages', 'components', 'lib', 'src'],
  },
  
  // Server external packages
  serverExternalPackages: ['ws'],
  
  // Typed routes (disabled temporarily to fix build issues)
  // typedRoutes: true,
  
  // Experimental features
  experimental: {
    // App Router is stable in Next.js 15
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  
  // Logging
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
  
  // Bundle analyzer (uncomment when needed)
  // ...(process.env.ANALYZE === 'true' && {
  //   webpack: (config) => {
  //     config.plugins.push(
  //       new (require('@next/bundle-analyzer')({
  //         enabled: true,
  //       }))()
  //     );
  //     return config;
  //   },
  // }),
};

module.exports = nextConfig;
