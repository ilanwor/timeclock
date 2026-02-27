import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user, role, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top nav */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="font-bold text-lg">TimeClock Pro</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm">
            {user?.first_name} {user?.last_name}
            <span className="ml-2 text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full">
              {role?.name}
            </span>
          </span>
          <button
            onClick={logout}
            className="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5
                       border border-slate-700 hover:border-slate-500 rounded-lg"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Content placeholder */}
      <main className="p-8">
        <h2 className="text-2xl font-bold mb-2">Dashboard</h2>
        <p className="text-slate-400 mb-6">Welcome back, {user?.first_name}.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {['Employees Clocked In', 'On Break', 'Total Hours Today'].map((label, i) => (
            <div key={label} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <p className="text-slate-400 text-sm mb-1">{label}</p>
              <p className="text-3xl font-bold text-white">—</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Manage Users',    to: '/admin/users',    desc: 'Add, edit, deactivate employees' },
            { label: 'Manage Roles',    to: '/admin/roles',    desc: 'Configure permissions per role' },
            { label: 'Manage Stores',   to: '/admin/stores',   desc: 'Store locations and details' },
            { label: 'Settings',        to: '/admin/settings', desc: 'Rules, breaks, kiosk colors' },
          ].map(item => (
            <Link key={item.to} to={item.to}
              className="bg-slate-800 rounded-xl p-5 border border-slate-700 hover:border-blue-500
                         hover:bg-slate-700/60 transition-colors group">
              <p className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                {item.label}
              </p>
              <p className="text-slate-400 text-xs mt-1">{item.desc}</p>
            </Link>
          ))}
        </div>

        <Link
          to="/"
          className="inline-block mt-6 text-slate-500 hover:text-slate-300 text-sm transition-colors"
        >
          ← Back to Kiosk
        </Link>
      </main>
    </div>
  )
}
