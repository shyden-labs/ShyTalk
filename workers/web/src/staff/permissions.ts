/**
 * Staff permissions (plan 6.1 Task 4, shyden-labs/ShyTalk#77 AC 3; plan 10
 * widens them). A role grants permissions; `STAFF_ADMINS`, a per-environment
 * Wrangler secret of comma-separated user ids, names who holds `admin`. Ids,
 * never emails, so no personal data sits in configuration.
 */
export type Permission = 'floor.manage';
export type Role = 'admin';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = { admin: ['floor.manage'] };

export interface StaffEnv {
  STAFF_ADMINS?: string;
}

/** `userId`'s staff role, or null for a member who holds none. */
export function staffRole(userId: string, env: StaffEnv): Role | null {
  const admins = (env.STAFF_ADMINS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  return admins.includes(userId) ? 'admin' : null;
}

/** Every permission `userId` holds. */
export function permissionsOf(userId: string, env: StaffEnv): readonly Permission[] {
  const role = staffRole(userId, env);
  return role === null ? [] : ROLE_PERMISSIONS[role];
}

/** Whether `userId` holds `permission`. */
export const can = (userId: string, permission: Permission, env: StaffEnv): boolean => permissionsOf(userId, env).includes(permission);
