import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }   from './context/AuthContext'
import ProtectedRoute     from './components/ProtectedRoute'
import KioskHome          from './pages/KioskHome'
import Login              from './pages/Login'
import Dashboard          from './pages/Dashboard'
import AdminLayout        from './pages/admin/AdminLayout'
import AdminUsers         from './pages/admin/AdminUsers'
import AdminRoles         from './pages/admin/AdminRoles'
import AdminStores        from './pages/admin/AdminStores'
import AdminSettings      from './pages/admin/AdminSettings'
import AdminNotifications from './pages/admin/AdminNotifications'
import AdminReports       from './pages/admin/AdminReports'
import AdminInbox         from './pages/admin/AdminInbox'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"          element={<KioskHome />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />

          {/* Admin panel — nested routes share AdminLayout sidebar */}
          <Route path="/admin" element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }>
            <Route index        element={<Navigate to="inbox" replace />} />
            <Route path="inbox"    element={<AdminInbox />} />
            <Route path="users"    element={<AdminUsers />} />
            <Route path="roles"    element={<AdminRoles />} />
            <Route path="stores"   element={<AdminStores />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="settings"       element={<AdminSettings />} />
            <Route path="reports"        element={<AdminReports />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
