import type { Role } from '../types';

/**
 * Centralized role capability checks.
 * Owner bypasses all. UI hiding is supplementary; handlers must enforce these.
 */

export function canSeeActiveBays(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'FOREMAN') return true;
  if (role === 'ADVISOR') return false;
  return false;
}

export function canAssignBay(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'FOREMAN') return true;
  if (role === 'ADVISOR') return false;
  return false;
}

export function canCreateOrder(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'ADVISOR') return true;
  if (role === 'FOREMAN') return false;
  return false;
}

export function canChangeStatus(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'ADVISOR') return true;
  if (role === 'FOREMAN') return true;
  return false;
}

export function canChangePayment(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'ADVISOR') return true;
  if (role === 'FOREMAN') return true;
  return false;
}

export function canBroadcast(role: Role): boolean {
  if (role === 'OWNER') return true;
  if (role === 'ADVISOR') return true;
  if (role === 'FOREMAN') return false;
  return false;
}
