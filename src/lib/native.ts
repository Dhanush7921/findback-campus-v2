import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { clearSession } from './session';

/** Native shell behaviour: status bar, splash, hardware back button, and lifecycle-based session hygiene. */
export async function initNative() {
  try { await StatusBar.setStyle({ style: Style.Light }); await StatusBar.setBackgroundColor({ color: '#f8fbfa' }); } catch { /* iOS ignores colour */ }
  await SplashScreen.hide().catch(() => undefined);
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else CapApp.exitApp();
  });
  // If the app sits in the background for > 5 minutes, drop sessions so a lost phone doesn't expose a complaint.
  let hiddenAt = 0;
  CapApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) { clearSession('reporter'); clearSession('staff'); }
  });
}
