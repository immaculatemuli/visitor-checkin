import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import './index.css';
import CheckIn from './pages/CheckIn';
import Pass from './pages/Pass';

// Staff screens are split out so visitors' phones only download the check-in flow.
const Poster = lazy(() => import('./pages/Poster'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Login = lazy(() => import('./pages/admin/Login'));
const Live = lazy(() => import('./pages/admin/Live'));
const History = lazy(() => import('./pages/admin/History'));
const ManualCheckIn = lazy(() => import('./pages/admin/ManualCheckIn'));
const Watchlist = lazy(() => import('./pages/admin/Watchlist'));
const OfficeWifi = lazy(() => import('./pages/admin/OfficeWifi'));
const StaffPage = lazy(() => import('./pages/admin/StaffPage'));
const Audit = lazy(() => import('./pages/admin/Audit'));
const VerifyPass = lazy(() => import('./pages/admin/VerifyPass'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Navigate to="/checkin" replace />} />
          <Route path="/checkin" element={<CheckIn />} />
          <Route path="/pass" element={<Pass />} />
          <Route path="/poster" element={<Poster />} />
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Live />} />
            <Route path="history" element={<History />} />
            <Route path="manual" element={<ManualCheckIn />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="wifi" element={<OfficeWifi />} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="audit" element={<Audit />} />
            <Route path="verify/:passNumber" element={<VerifyPass />} />
          </Route>
          <Route path="*" element={<Navigate to="/checkin" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
