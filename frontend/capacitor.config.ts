import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.attendance.app',
  appName: 'Attendance App',
  webDir: 'dist',
  server: {
    // Serve the bundled app from https://localhost so camera (getUserMedia) and WebAssembly work in the WebView
    androidScheme: 'https',
  },
  plugins: {
    // The app talks to the live Vercel API; no Capgo over-the-air bundles are used
    CapacitorUpdater: {
      autoUpdate: false,
    },
  },
};

export default config;
