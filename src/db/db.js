import Dexie from 'dexie';
import bcrypt from 'bcryptjs';

// ─────────────────────────────────────────────
// Database definition
// ─────────────────────────────────────────────
export const db = new Dexie('TimeclockDB');

db.version(1).stores({
  // Stores / locations
  // id, name, address, phone, timezone, is_active, created_at
  stores:
    '++id, name, timezone, is_active, created_at',

  // Roles (Super Admin / Manager / Supervisor / Employee)
  // id, name, permissions (JSON string), created_at
  roles:
    '++id, &name, created_at',

  // Users
  // id, store_id, role_id, first_name, last_name, email,
  // password_hash, pin_hash, is_active, created_at, updated_at
  users:
    '++id, store_id, role_id, &email, is_active, created_at',

  // Time entries (one per clock-in session)
  // id, user_id, store_id, clock_in, clock_out,
  // total_minutes, status (open|closed|approved|disputed),
  // notes, created_at, updated_at
  time_entries:
    '++id, user_id, store_id, clock_in, clock_out, status, created_at',

  // Breaks linked to a time entry
  // id, time_entry_id, user_id, break_start, break_end,
  // break_type (paid|unpaid), duration_minutes, created_at
  breaks:
    '++id, time_entry_id, user_id, break_start, break_end, break_type',

  // Responses to alerts/notifications
  // id, alert_id, user_id, response (acknowledged|dismissed|actioned),
  // notes, responded_at
  notification_responses:
    '++id, alert_id, user_id, responded_at',

  // Alerts / notifications
  // id, store_id, created_by_user_id, target_role_id, target_user_id (nullable),
  // type (info|warning|urgent|schedule), title, message,
  // is_read, created_at, expires_at
  alerts:
    '++id, store_id, created_by_user_id, target_role_id, target_user_id, type, is_read, created_at, expires_at',

  // Key-value settings per store (or global when store_id = 0)
  // id, store_id, key, value (JSON string), updated_at
  settings:
    '++id, [store_id+key], store_id, key',

  // Audit log — immutable record of every state change
  // id, user_id, store_id, action, entity_type, entity_id,
  // old_value (JSON), new_value (JSON), ip_address, created_at
  audit_log:
    '++id, user_id, store_id, action, entity_type, entity_id, created_at',
});

// ── v2: add role_id + user_id to settings for priority-based rule overrides ──
// Existing records get role_id = null, user_id = null (global scope).
db.version(2).stores({
  settings: '++id, [store_id+key], store_id, key, role_id, user_id',
}).upgrade(tx =>
  tx.table('settings').toCollection().modify(row => {
    if (row.role_id === undefined) row.role_id = null
    if (row.user_id === undefined) row.user_id = null
  })
);

// ── v3: structured notification templates + extend notification_responses ───
// notifications: admin-created event-triggered prompts with questions + actions.
// notification_responses: gains notification_id index for structured responses.
db.version(3).stores({
  notifications: '++id, store_id, trigger_event, scope_type, scope_id, is_active, created_at',
  notification_responses: '++id, alert_id, notification_id, user_id, responded_at',
});

// ─────────────────────────────────────────────
// Seed data
// ─────────────────────────────────────────────
const SALT_ROUNDS = 10;

const ROLES = [
  {
    name: 'Super Admin',
    permissions: {
      manage_stores: true,
      manage_roles: true,
      manage_users: true,
      manage_settings: true,
      clock_in_out: true,
      edit_own_time: true,
      edit_any_time: true,
      approve_time_entries: true,
      view_own_reports: true,
      view_store_reports: true,
      view_all_reports: true,
      view_audit_log: true,
      manage_alerts: true,
      respond_to_alerts: true,
    },
  },
  {
    name: 'Manager',
    permissions: {
      manage_stores: false,
      manage_roles: false,
      manage_users: true,        // within own store
      manage_settings: true,     // within own store
      clock_in_out: true,
      edit_own_time: true,
      edit_any_time: true,       // within own store
      approve_time_entries: true,
      view_own_reports: true,
      view_store_reports: true,
      view_all_reports: false,
      view_audit_log: true,      // within own store
      manage_alerts: true,
      respond_to_alerts: true,
    },
  },
  {
    name: 'Supervisor',
    permissions: {
      manage_stores: false,
      manage_roles: false,
      manage_users: false,
      manage_settings: false,
      clock_in_out: true,
      edit_own_time: true,
      edit_any_time: false,
      approve_time_entries: true,
      view_own_reports: true,
      view_store_reports: true,
      view_all_reports: false,
      view_audit_log: false,
      manage_alerts: false,
      respond_to_alerts: true,
    },
  },
  {
    name: 'Employee',
    permissions: {
      manage_stores: false,
      manage_roles: false,
      manage_users: false,
      manage_settings: false,
      clock_in_out: true,
      edit_own_time: false,
      edit_any_time: false,
      approve_time_entries: false,
      view_own_reports: true,
      view_store_reports: false,
      view_all_reports: false,
      view_audit_log: false,
      manage_alerts: false,
      respond_to_alerts: true,
    },
  },
];

const STORES_SEED = [
  {
    name: 'Main Street Store',
    address: '123 Main Street, Springfield, IL 62701',
    phone: '(217) 555-0101',
    timezone: 'America/Chicago',
    is_active: 1,
    created_at: new Date().toISOString(),
  },
  {
    name: 'Westside Branch',
    address: '456 West Ave, Springfield, IL 62704',
    phone: '(217) 555-0202',
    timezone: 'America/Chicago',
    is_active: 1,
    created_at: new Date().toISOString(),
  },
];

// Test users: [first, last, email, password, pin, roleName, storeIndex (0-based)]
const USERS_SEED = [
  {
    first_name: 'Admin',
    last_name: 'User',
    email: 'admin@timeclock.com',
    password: 'Admin1234!',
    pin: '0000',
    role_name: 'Super Admin',
    store_index: 0,
  },
  {
    first_name: 'Maria',
    last_name: 'Garcia',
    email: 'manager@timeclock.com',
    password: 'Manager1234!',
    pin: '1111',
    role_name: 'Manager',
    store_index: 0,
  },
  {
    first_name: 'John',
    last_name: 'Smith',
    email: 'employee@timeclock.com',
    password: 'Employee1234!',
    pin: '2222',
    role_name: 'Employee',
    store_index: 0,
  },
];

const DEFAULT_SETTINGS = [
  // Global settings (store_id = 0)
  { store_id: 0, key: 'app_name',              value: 'TimeClock Pro' },
  { store_id: 0, key: 'max_shift_hours',       value: '12' },
  { store_id: 0, key: 'overtime_threshold',    value: '40' },       // weekly hrs
  { store_id: 0, key: 'break_required_after',  value: '6' },        // hrs worked
  { store_id: 0, key: 'paid_break_minutes',    value: '15' },
  { store_id: 0, key: 'unpaid_break_minutes',  value: '30' },
  { store_id: 0, key: 'pin_length',            value: '4' },
  { store_id: 0, key: 'session_timeout_mins',  value: '30' },
  // Per-store settings (store_id = 1, filled after store insert)
  { store_id: 1, key: 'open_time',             value: '07:00' },
  { store_id: 1, key: 'close_time',            value: '22:00' },
  { store_id: 2, key: 'open_time',             value: '08:00' },
  { store_id: 2, key: 'close_time',            value: '21:00' },
];

export async function seedDatabase() {
  // Guard: skip if already seeded
  const roleCount = await db.roles.count();
  if (roleCount > 0) return;

  await db.transaction(
    'rw',
    [db.stores, db.roles, db.users, db.settings, db.audit_log],
    async () => {
      const now = new Date().toISOString();

      // 1. Insert stores
      const storeIds = [];
      for (const store of STORES_SEED) {
        const id = await db.stores.add(store);
        storeIds.push(id);
      }

      // 2. Insert roles
      const roleMap = {};
      for (const role of ROLES) {
        const id = await db.roles.add({
          name: role.name,
          permissions: JSON.stringify(role.permissions),
          created_at: now,
        });
        roleMap[role.name] = id;
      }

      // 3. Insert users (hash password + pin)
      for (const u of USERS_SEED) {
        const [password_hash, pin_hash] = await Promise.all([
          bcrypt.hash(u.password, SALT_ROUNDS),
          bcrypt.hash(u.pin, SALT_ROUNDS),
        ]);

        await db.users.add({
          store_id:      storeIds[u.store_index],
          role_id:       roleMap[u.role_name],
          first_name:    u.first_name,
          last_name:     u.last_name,
          email:         u.email,
          password_hash,
          pin_hash,
          is_active:     1,
          created_at:    now,
          updated_at:    now,
        });
      }

      // 4. Insert settings
      for (const s of DEFAULT_SETTINGS) {
        await db.settings.add({ ...s, updated_at: now });
      }

      // 5. Write initial audit entry
      await db.audit_log.add({
        user_id:     null,
        store_id:    null,
        action:      'seed',
        entity_type: 'database',
        entity_id:   null,
        old_value:   null,
        new_value:   JSON.stringify({ stores: storeIds, roles: Object.keys(roleMap) }),
        ip_address:  null,
        created_at:  now,
      });
    }
  );

  console.log('[DB] Seed complete — stores, roles, users, settings initialized.');
}

// ─────────────────────────────────────────────
// Helper: verify password
// ─────────────────────────────────────────────
export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

// ─────────────────────────────────────────────
// Helper: verify PIN
// ─────────────────────────────────────────────
export async function verifyPin(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

// ─────────────────────────────────────────────
// Helper: write audit log entry
// ─────────────────────────────────────────────
export async function writeAuditLog({ userId, storeId, action, entityType, entityId, oldValue, newValue }) {
  await db.audit_log.add({
    user_id:     userId   ?? null,
    store_id:    storeId  ?? null,
    action,
    entity_type: entityType,
    entity_id:   entityId ?? null,
    old_value:   oldValue  != null ? JSON.stringify(oldValue)  : null,
    new_value:   newValue  != null ? JSON.stringify(newValue)  : null,
    ip_address:  null,
    created_at:  new Date().toISOString(),
  });
}
