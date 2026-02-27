import { createContext, useContext, useState, useEffect } from 'react'
import { db, verifyPassword } from '../db/db'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [role, setRole]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('tc_admin')
      if (raw) {
        const { user, role } = JSON.parse(raw)
        setUser(user)
        setRole(role)
      }
    } catch (_) {}
    setLoading(false)
  }, [])

  async function login(email, password) {
    const found = await db.users.where('email').equals(email).first()
    if (!found || !found.is_active) throw new Error('User not found or inactive.')

    const ok = await verifyPassword(password, found.password_hash)
    if (!ok) throw new Error('Incorrect password.')

    const foundRole = await db.roles.get(found.role_id)
    const permissions = JSON.parse(foundRole.permissions)
    const sessionUser = { ...found, permissions }

    setUser(sessionUser)
    setRole(foundRole)
    sessionStorage.setItem('tc_admin', JSON.stringify({ user: sessionUser, role: foundRole }))
    return sessionUser
  }

  function logout() {
    setUser(null)
    setRole(null)
    sessionStorage.removeItem('tc_admin')
  }

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
