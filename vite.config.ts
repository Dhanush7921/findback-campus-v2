import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const native = mode === 'native';
  // GitHub Pages serves the app under /<repo>/ unless a custom domain is used (set VITE_BASE=/).
  const base = native ? '/' : env.VITE_BASE || '/';
  const apiOrigin = (() => {
    try { return env.VITE_API_BASE ? new URL(env.VITE_API_BASE).origin : ''; } catch { return ''; }
  })();

  // GitHub Pages cannot send HTTP headers, so ship a strict CSP as a meta tag.
  const csp: Plugin = {
    name: 'findback-csp',
    transformIndexHtml(html) {
      if (mode === 'development') return html;
      const policy = [
        "default-src 'self'",
        // Firebase Auth: reCAPTCHA (phone codes), Google sign-in helper iframe on <project>.firebaseapp.com, token endpoints.
        "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://apis.google.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ${apiOrigin} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.google.com/recaptcha/`.replace(/  +/g, ' '),
        'frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://*.firebaseapp.com',
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      csp,
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: null,
        disable: native,
        includeAssets: ['icons/*.png', 'icons/*.svg'],
        manifest: {
          name: 'FindBack — Campus Lost & Found',
          short_name: 'FindBack',
          description: 'Report lost items and track recovery on campus — privately and securely.',
          theme_color: '#0d9488',
          background_color: '#f8fbfa',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          lang: 'en',
          categories: ['education', 'utilities'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only static assets are cached. API responses are never cached (privacy).
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 400,
    },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
