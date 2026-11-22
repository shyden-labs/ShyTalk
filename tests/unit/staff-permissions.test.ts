import { describe, expect, it } from 'vitest';
import { can, ROLE_PERMISSIONS, staffRole } from '../../workers/web/src/staff/permissions.ts';

/**
 * Staff permissions (plan 6.1 Task 4, shyden-labs/ShyTalk#77 AC 3): a role
 * grants permissions, and `STAFF_ADMINS` (a per-environment secret of
 * comma-separated user ids) names who holds the admin role.
 */

describe('staffRole', () => {
  it('names a listed user an admin, spaces around the ids ignored', () => {
    expect(staffRole('u2', { STAFF_ADMINS: ' u1 , u2' })).toBe('admin');
  });

  it('gives an unlisted user no role', () => {
    expect(staffRole('u3', { STAFF_ADMINS: ' u1 , u2' })).toBeNull();
  });

  it('gives no one a role when the list is unset', () => {
    expect(staffRole('u1', {})).toBeNull();
  });

  it('gives no one a role when the list is empty', () => {
    expect(staffRole('', { STAFF_ADMINS: '' })).toBeNull();
  });

  it('never matches an empty id between two commas', () => {
    expect(staffRole('', { STAFF_ADMINS: 'u1,,u2' })).toBeNull();
  });
});

describe('can', () => {
  it('lets an admin manage the floor', () => {
    expect(can('u1', 'floor.manage', { STAFF_ADMINS: 'u1' })).toBe(true);
  });

  it('refuses a member with no role', () => {
    expect(can('u9', 'floor.manage', { STAFF_ADMINS: 'u1' })).toBe(false);
  });

  it('gives the admin role every permission', () => {
    expect(ROLE_PERMISSIONS.admin).toEqual(['floor.manage']);
  });
});
