import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'buy-now-or-live',
  web: {
    host: 'localhost',
    port: 8080,
    commands: {
      dev: 'vite --host 0.0.0.0 --port 8080',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
  brand: {
    displayName: 'BUY NOW OR LIVE',
    icon: 'https://raw.githubusercontent.com/zomdaa/LIVE_SCHEDULER_3/main/assets/icon-512.png',
    primaryColor: '#ea2804',
    bridgeColorMode: 'basic',
  },
  webViewProps: {
    type: 'partner',
  },
});
