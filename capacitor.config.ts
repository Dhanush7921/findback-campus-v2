import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.findback.campusv2',
  appName: 'FindBack V2',
  webDir: 'dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'always', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#f8fbfa', showSpinner: false, androidScaleType: 'CENTER_CROP' },
    StatusBar: { style: 'LIGHT', backgroundColor: '#f8fbfa', overlaysWebView: false },
  },
};
export default config;
