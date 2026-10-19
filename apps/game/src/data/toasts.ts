import type { ToastCode as ServerToastCode } from '@gravity-harvest/shared';

// What each toast sounds like, by its code (the server's, packages/shared match.ts, and the browser's own). The text is
// only for display, so rewording a message never changes its sound.

/** The server's codes, and the refusals only the browser makes (before an order is sent). */
export type ToastCode = ServerToastCode | 'noRoom' | 'devOnly';

/** A message to show: plain text, or text with a code (it then gets that code's sound). */
export type ToastMessage = string | { text: string; code: ToastCode };

/** 'refused': the error sound. 'noMoney': the announcer says so (the error sound if he has no such line). Absent: silent. */
export type ToastSound = 'refused' | 'noMoney';

export const TOAST_SOUNDS: Readonly<Record<ToastCode, ToastSound | null>> = {
  needCredits: 'noMoney',
  repairNoCredits: 'noMoney',
  needPrerequisite: 'refused',
  needAssemblyYard: 'refused',
  alreadyBuilding: 'refused',
  cantPlace: 'refused',
  cantDeploy: 'refused',
  unitCap: 'refused',
  queueFull: 'refused',
  notDamaged: 'refused',
  noRoom: 'refused',
  devOnly: 'refused',
  sold: null,
  cancelled: null,
  buildingReady: null,
  unitReady: null,
  repaired: null,
  buildingDestroyed: null,
  enemyBuildingDestroyed: null,
};
