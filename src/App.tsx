import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router';
import DemoBanner from './components/DemoBanner';
import Layout from './components/Layout';
import { ToastProvider } from './components/toast';
import { PageSkeleton } from './components/ui';
import { ConfigProvider } from './lib/config';
import { IS_NATIVE } from './lib/env';
import { I18nProvider } from './lib/i18n';
import Home from './pages/public/Home';

const HowItWorks = lazy(() => import('./pages/public/HowItWorks'));
const Help = lazy(() => import('./pages/public/Help'));
const Privacy = lazy(() => import('./pages/public/Privacy'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const PhoneLogin = lazy(() => import('./pages/auth/PhoneLogin'));
const DemoLogin = lazy(() => import('./pages/public/DemoLogin'));

const MeLayout = lazy(() => import('./pages/me/MeLayout'));
const MeDashboard = lazy(() => import('./pages/me/Dashboard'));
const MeReport = lazy(() => import('./pages/me/Report'));
const MeComplaint = lazy(() => import('./pages/me/ComplaintView'));
const MeAcknowledge = lazy(() => import('./pages/me/Acknowledge'));

const StaffLayout = lazy(() => import('./pages/staff/StaffLayout'));
const StaffDashboard = lazy(() => import('./pages/staff/Dashboard'));
const StaffRegister = lazy(() => import('./pages/staff/RegisterItem'));
const StaffInventory = lazy(() => import('./pages/staff/Inventory'));
const StaffItem = lazy(() => import('./pages/staff/ItemDetail'));
const StaffComplaints = lazy(() => import('./pages/staff/Complaints'));
const StaffComplaint = lazy(() => import('./pages/staff/ComplaintDetail'));
const StaffMatching = lazy(() => import('./pages/staff/Matching'));
const StaffClaims = lazy(() => import('./pages/staff/Claims'));
const StaffHandovers = lazy(() => import('./pages/staff/Handovers'));
const StaffUnclaimed = lazy(() => import('./pages/staff/Unclaimed'));
const StaffRegistry = lazy(() => import('./pages/staff/Registry'));
const StaffPeople = lazy(() => import('./pages/staff/People'));
const StaffSettings = lazy(() => import('./pages/staff/Settings'));

const MgmtLayout = lazy(() => import('./pages/mgmt/MgmtLayout'));
const MgmtOverview = lazy(() => import('./pages/mgmt/Overview'));
const MgmtTrends = lazy(() => import('./pages/mgmt/Trends'));
const MgmtHotspots = lazy(() => import('./pages/mgmt/Hotspots'));
const MgmtAudit = lazy(() => import('./pages/mgmt/Audit'));
const MgmtPolicies = lazy(() => import('./pages/mgmt/Policies'));
const MgmtComplaints = lazy(() => import('./pages/mgmt/Records').then((m) => ({ default: m.MgmtComplaints })));
const MgmtFound = lazy(() => import('./pages/mgmt/Records').then((m) => ({ default: m.MgmtFound })));
const MgmtHandovers = lazy(() => import('./pages/mgmt/Records').then((m) => ({ default: m.MgmtHandovers })));

// Native apps load from a local origin, where hash routing avoids server rewrites.
const Router = IS_NATIVE ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfigProvider>
          <Router basename={IS_NATIVE ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
            <DemoBanner />
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Home />} />
                  <Route path="how-it-works" element={<HowItWorks />} />
                  <Route path="help" element={<Help />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="student" element={<PhoneLogin portal="student" />} />
                  <Route path="guest" element={<PhoneLogin portal="guest" />} />
                  <Route path="demo/:role?" element={<DemoLogin />} />
                  <Route path="report" element={<Navigate to="/student" replace />} />
                  <Route path="track" element={<Navigate to="/student" replace />} />
                  <Route path="me" element={<MeLayout />}>
                    <Route index element={<MeDashboard />} />
                    <Route path="report" element={<MeReport />} />
                    <Route path="complaints/:id" element={<MeComplaint />} />
                    <Route path="acknowledge" element={<MeAcknowledge />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="staff" element={<StaffLayout />}>
                  <Route index element={<StaffDashboard />} />
                  <Route path="register" element={<StaffRegister />} />
                  <Route path="inventory" element={<StaffInventory />} />
                  <Route path="inventory/:id" element={<StaffItem />} />
                  <Route path="complaints" element={<StaffComplaints />} />
                  <Route path="complaints/:id" element={<StaffComplaint />} />
                  <Route path="matching" element={<StaffMatching />} />
                  <Route path="claims" element={<StaffClaims />} />
                  <Route path="handovers" element={<StaffHandovers />} />
                  <Route path="unclaimed" element={<StaffUnclaimed />} />
                  <Route path="registry" element={<StaffRegistry />} />
                  <Route path="people" element={<StaffPeople />} />
                  <Route path="activity" element={<MgmtAudit source="staff" />} />
                  <Route path="analytics" element={<MgmtTrends />} />
                  <Route path="settings" element={<StaffSettings />} />
                </Route>
                <Route path="management" element={<MgmtLayout />}>
                  <Route index element={<MgmtOverview />} />
                  <Route path="trends" element={<MgmtTrends />} />
                  <Route path="hotspots" element={<MgmtHotspots />} />
                  <Route path="complaints" element={<MgmtComplaints />} />
                  <Route path="found" element={<MgmtFound />} />
                  <Route path="handovers" element={<MgmtHandovers />} />
                  <Route path="audit" element={<MgmtAudit />} />
                  <Route path="policies" element={<MgmtPolicies />} />
                </Route>
              </Routes>
            </Suspense>
          </Router>
        </ConfigProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
