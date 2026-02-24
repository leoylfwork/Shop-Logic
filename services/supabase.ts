/**
 * Data service abstraction for CK-Flow.
 * Uses Supabase (repair_orders, bays, event_log) when client is configured;
 * falls back to localStorage otherwise. History = status = DONE AND payment_status IN ('paid','voided').
 */

import { ROStatus, type RepairOrder, type Bay, type CalendarEvent, type WorkType } from '../types';
import type { LogEntry } from '../types';
import { supabase } from './supabaseClient';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KEYS = {
  ros: 'ck_flow_ros_v14',
  bays: 'ck_flow_bays_v14',
  calendar: 'ck_flow_calendar_v3',
  orderAdvisor: 'ck_flow_order_advisor_v5',
  orderForeman: 'ck_flow_order_foreman_v5',
  orderOwner: 'ck_flow_order_owner_v5',
  orderBody: 'ck_flow_order_body_v5',
  collapsed: 'ck_flow_collapsed_v2',
  role: 'ck_flow_role',
  workType: 'ck_flow_work_type',
} as const;

type ColumnOrderKey = keyof Pick<typeof KEYS, 'orderAdvisor' | 'orderForeman' | 'orderOwner' | 'orderBody'>;

/** Empty string, undefined, or NaN → null for nullable DB columns (date/timestamp/number). */
function toNullable<T>(value: T): T | null {
  if (value === '' || value === undefined) return null;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  return value;
}

// --- Serialization: frontend ROStatus (workflow) <-> DB status (persistence) ---

const STATUS_TO_DB: Partial<Record<ROStatus, string>> = {
  [ROStatus.TODO]: 'TO_DO',
  [ROStatus.PENDING]: 'PENDING',
  [ROStatus.IN_PROGRESS]: 'IN_PROGRESS',
  [ROStatus.DONE]: 'DONE',
  [ROStatus.BODY_WORK]: 'BODY_WORK',
  [ROStatus.PAINTING]: 'PAINTING',
  [ROStatus.FINISHING_UP]: 'FINISHING_UP',
  [ROStatus.MECHANIC_WORK]: 'MECHANIC_WORK',
};

const DB_TO_STATUS: Record<string, ROStatus> = {
  TO_DO: ROStatus.TODO,
  PENDING: ROStatus.PENDING,
  IN_PROGRESS: ROStatus.IN_PROGRESS,
  DONE: ROStatus.DONE,
  BODY_WORK: ROStatus.BODY_WORK,
  PAINTING: ROStatus.PAINTING,
  FINISHING_UP: ROStatus.FINISHING_UP,
  MECHANIC_WORK: ROStatus.MECHANIC_WORK,
};

const MODEL_META_PREFIX = '__CK_MODEL__:';

function encodeInfoWithModel(info: string, model: string): string {
  const cleanInfo = info.startsWith(MODEL_META_PREFIX)
    ? info.split('\n').slice(1).join('\n')
    : info;
  const safeModel = encodeURIComponent(model || '');
  return `${MODEL_META_PREFIX}${safeModel}\n${cleanInfo ?? ''}`;
}

function decodeInfoAndModel(rawInfo: string, fallbackModel: string): { info: string; model: string } {
  if (!rawInfo.startsWith(MODEL_META_PREFIX)) {
    return { info: rawInfo, model: fallbackModel };
  }
  const [firstLine, ...rest] = rawInfo.split('\n');
  const encodedModel = firstLine.slice(MODEL_META_PREFIX.length);
  const model = decodeURIComponent(encodedModel || '') || fallbackModel;
  return { info: rest.join('\n'), model };
}

const DEFAULT_BAYS: Array<{ name: string; workType: WorkType }> = [
  { name: 'Bay 1', workType: 'MECHANIC' },
  { name: 'Bay 2', workType: 'MECHANIC' },
  { name: 'Bay 3', workType: 'MECHANIC' },
  { name: 'Bay 4', workType: 'MECHANIC' },
  { name: 'Bay 5', workType: 'MECHANIC' },
  { name: 'Oil Changer', workType: 'MECHANIC' },
  { name: 'Body Work', workType: 'BODY' },
  { name: 'Painting and Prep', workType: 'BODY' },
  { name: 'Mechanic Shop To-do', workType: 'BODY' },
];

async function seedDefaultBaysIfEmpty(): Promise<void> {
  if (!supabase) return;
  const { data: existing } = await supabase.from('bays').select('id').limit(1);
  if (existing && existing.length > 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
  if (!profile?.shop_id) return;
  const rows = DEFAULT_BAYS.map((b, i) => ({
    shop_id: profile.shop_id,
    name: b.name,
    work_type: b.workType,
    sort_order: i,
  }));
  await supabase.from('bays').insert(rows);
}

/**
 * Serialize a full RepairOrder for DB insert/update. Maps frontend status to DB; INSURANCE → is_insurance_case + TO_DO; ARCHIVED → DONE + payment_status; ORDER_LIST → never stored (mapped to DONE).
 */
export function serializeRepairOrderForDB(ro: RepairOrder): Record<string, unknown> {
  let dbStatus: string;
  let paymentStatus: 'paid' | 'voided' | null = null;
  if (ro.status === ROStatus.ARCHIVED) {
    dbStatus = 'DONE';
    paymentStatus = ro.paymentMethod === 'ABANDONED' ? 'voided' : 'paid';
  } else if (ro.status === ROStatus.ORDER_LIST) {
    dbStatus = 'DONE';
  } else if (ro.status === ROStatus.INSURANCE) {
    dbStatus = 'TO_DO';
  } else {
    dbStatus = STATUS_TO_DB[ro.status] ?? 'TO_DO';
  }
  const isInsuranceCase = ro.status === ROStatus.INSURANCE || Boolean(ro.isInsuranceCase);
  const bayUuid = ro.bayId != null ? bayNumberToUuid.get(ro.bayId) ?? null : null;
  return {
    work_type: ro.workType,
    status: dbStatus,
    is_insurance_case: isInsuranceCase,
    payment_status: paymentStatus ?? (ro.settledAt != null ? (ro.paymentMethod === 'ABANDONED' ? 'voided' : 'paid') : null),
    payment_method: ro.paymentMethod ?? null,
    payment_amount: toNullable(ro.paymentAmount ?? null),
    settled_at: toNullable(ro.settledAt),
    vin: ro.vin ?? '',
    customer_name: ro.customerName ?? '',
    customer_phone: ro.phone ?? '',
    info: encodeInfoWithModel(ro.info ?? '', ro.model ?? ''),
    urgent: ro.urgent ?? false,
    mileage: toNullable(ro.mileage ?? null),
    delivery_date: toNullable(ro.deliveryDate ?? null),
    bay_id: bayUuid,
    last_entered_bay_at: ro.lastEnteredBayAt != null ? new Date(ro.lastEnteredBayAt).toISOString() : null,
    total_time_in_bay_ms: toNullable(ro.totalTimeInBay ?? 0) ?? 0,
    order_index: toNullable(ro.order ?? 0) ?? 0,
    grid_position: toNullable(ro.gridPosition ?? null),
    calendar_event_id: toNullable(ro.calendarEventId ?? null),
  };
}

export type RepairOrderUpdate = Partial<Pick<RepairOrder, 'status' | 'paymentMethod' | 'paymentAmount' | 'settledAt' | 'vin' | 'customerName' | 'phone' | 'info' | 'model' | 'urgent' | 'mileage' | 'deliveryDate' | 'gridPosition' | 'calendarEventId' | 'isInsuranceCase'>>;

/**
 * Serialize a partial update for DB. Status: ARCHIVED → DONE + payment_status; INSURANCE → TO_DO + is_insurance_case; ORDER_LIST not stored (omitted).
 */
export function serializeRepairOrderUpdate(updates: RepairOrderUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined) {
    if (updates.status === ROStatus.ARCHIVED) {
      payload.status = 'DONE';
      payload.payment_status = updates.paymentMethod === 'ABANDONED' ? 'voided' : 'paid';
    } else if (updates.status === ROStatus.INSURANCE) {
      payload.status = 'TO_DO';
      payload.is_insurance_case = true;
    } else if (updates.status !== ROStatus.ORDER_LIST) {
      payload.status = STATUS_TO_DB[updates.status] ?? 'TO_DO';
    }
  }
  if (updates.paymentMethod !== undefined) {
    payload.payment_method = updates.paymentMethod;
    if (payload.payment_status === undefined) payload.payment_status = updates.paymentMethod === 'ABANDONED' ? 'voided' : 'paid';
  }
  if (updates.paymentAmount !== undefined) payload.payment_amount = toNullable(updates.paymentAmount);
  if (updates.settledAt !== undefined) payload.settled_at = toNullable(updates.settledAt);
  if (updates.vin !== undefined) payload.vin = updates.vin;
  if (updates.customerName !== undefined) payload.customer_name = updates.customerName;
  if (updates.phone !== undefined) payload.customer_phone = updates.phone;
  if (updates.info !== undefined || updates.model !== undefined) {
    payload.info = encodeInfoWithModel(updates.info ?? '', updates.model ?? '');
  }
  if (updates.urgent !== undefined) payload.urgent = updates.urgent;
  if (updates.mileage !== undefined) payload.mileage = toNullable(updates.mileage);
  if (updates.deliveryDate !== undefined) payload.delivery_date = toNullable(updates.deliveryDate);
  if (updates.gridPosition !== undefined) payload.grid_position = toNullable(updates.gridPosition);
  if (updates.calendarEventId !== undefined) payload.calendar_event_id = toNullable(updates.calendarEventId);
  if (updates.isInsuranceCase !== undefined) payload.is_insurance_case = updates.isInsuranceCase;
  return payload;
}

/**
 * Reconstruct frontend RepairOrder from a DB row. DB status → ROStatus; is_insurance_case → INSURANCE; DONE + payment_status → ARCHIVED.
 */
export function deserializeRepairOrderFromDB(
  row: Record<string, unknown>,
  logs: LogEntry[],
  aiChat: LogEntry[],
  bayIdNum: number | undefined
): RepairOrder {
  const dbStatus = (row.status as string) ?? 'TO_DO';
  const paymentStatus = row.payment_status as string | null;
  const isInsuranceCase = Boolean(row.is_insurance_case);
  let status: ROStatus;
  if (dbStatus === 'DONE' && (paymentStatus === 'paid' || paymentStatus === 'voided')) {
    status = ROStatus.ARCHIVED;
  } else {
    status = DB_TO_STATUS[dbStatus] ?? ROStatus.TODO;
  }
  const rawInfo = (row.info as string) ?? '';
  const fallbackModel = (row.vin as string) ?? '';
  const { info, model } = decodeInfoAndModel(rawInfo, fallbackModel);
  return {
    id: String(row.id),
    model,
    vin: (row.vin as string) ?? '',
    customerName: (row.customer_name as string) ?? '',
    phone: (row.customer_phone as string) ?? '',
    info,
    status,
    urgent: Boolean(row.urgent),
    order: Number(row.order_index ?? 0),
    gridPosition: row.grid_position != null ? Number(row.grid_position) : undefined,
    lastReadInfo: { ADVISOR: '', FOREMAN: '', OWNER: '' },
    bayId: bayIdNum,
    totalTimeInBay: Number(row.total_time_in_bay_ms ?? 0),
    lastEnteredBayAt: row.last_entered_bay_at ? new Date(row.last_entered_bay_at as string).getTime() : undefined,
    unreadBy: [],
    paymentMethod: (row.payment_method as RepairOrder['paymentMethod']) ?? undefined,
    paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : undefined,
    settledAt: row.settled_at ? new Date(row.settled_at as string).toISOString() : undefined,
    logs,
    aiChat,
    isInsuranceCase: isInsuranceCase || undefined,
    attachments: (row.attachments as RepairOrder['attachments']) ?? undefined,
    calendarEventId: (row.calendar_event_id as string) ?? undefined,
    mileage: row.mileage != null ? Number(row.mileage) : undefined,
    deliveryDate: (row.delivery_date as string) ?? undefined,
    workType: (row.work_type as WorkType) ?? 'MECHANIC',
    decodedData: (row.decoded_data as RepairOrder['decodedData']) ?? undefined,
  };
}

// Bay numeric id <-> uuid mapping (built when fetching bays; used for repair_orders.bay_id)
let bayNumberToUuid: Map<number, string> = new Map();
let bayUuidToNumber: Map<string, number> = new Map();

function getItem<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setItem(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

function roleToDisplayName(role: string | null | undefined): string {
  if (!role) return 'User';
  const r = role.toLowerCase();
  if (r === 'advisor') return 'Advisor';
  if (r === 'foreman') return 'Foreman';
  if (r === 'owner') return 'Owner';
  return role;
}

type EventLogRow = {
  id: string;
  type: string;
  text: string;
  created_at: string;
  image_storage_path?: string | null;
  user_id?: string | null;
  profiles?: { role?: string | null } | { role?: string | null }[] | null;
};

function eventLogToLogEntry(row: EventLogRow): LogEntry {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const userLabel = row.user_id
    ? roleToDisplayName(profile?.role)
    : 'SYSTEM';
  return {
    id: row.id,
    timestamp: row.created_at,
    user: userLabel,
    text: row.text,
    type: row.type as 'SYSTEM' | 'USER' | 'AI',
    imageUrl: row.image_storage_path ?? undefined,
  };
}


export async function getRepairOrders(initial: RepairOrder[]): Promise<RepairOrder[]> {
  if (!supabase) return getItem<RepairOrder[]>(KEYS.ros, initial);

  const { data: rows, error } = await supabase.from('repair_orders').select('*').order('order_index', { ascending: true });
  if (error) {
    console.error('getRepairOrders:', error);
    return [];
  }
  if (!rows?.length) return [];

  const { data: logRows } = await supabase
    .from('event_log')
    .select('id, repair_order_id, entry_type, type, text, created_at, image_storage_path, user_id, profiles(role)');
  const logsByRo: Record<string, LogEntry[]> = {};
  const aiByRo: Record<string, LogEntry[]> = {};
  (logRows ?? []).forEach((r: EventLogRow & { repair_order_id: string; entry_type: string }) => {
    const list = r.entry_type === 'diagnostic' ? aiByRo : logsByRo;
    if (!list[r.repair_order_id]) list[r.repair_order_id] = [];
    list[r.repair_order_id].push(eventLogToLogEntry(r));
  });
  Object.keys(logsByRo).forEach(id => logsByRo[id].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
  Object.keys(aiByRo).forEach(id => aiByRo[id].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

  const { data: bayRows } = await supabase.from('bays').select('id, sort_order').order('sort_order', { ascending: true });
  bayUuidToNumber = new Map();
  bayNumberToUuid = new Map();
  (bayRows ?? []).forEach((b: { id: string }, i: number) => {
    const num = i + 1;
    bayNumberToUuid.set(num, b.id);
    bayUuidToNumber.set(b.id, num);
  });

  return rows.map((row: Record<string, unknown>) => {
    const roId = String(row.id);
    const bayUuid = row.bay_id as string | null;
    const bayIdNum = bayUuid ? bayUuidToNumber.get(bayUuid) : undefined;
    return deserializeRepairOrderFromDB(row, logsByRo[roId] ?? [], aiByRo[roId] ?? [], bayIdNum);
  });
}

export async function getBays(initial: Bay[]): Promise<Bay[]> {
  if (!supabase) return getItem<Bay[]>(KEYS.bays, initial);

  let { data: rows, error } = await supabase.from('bays').select('id, name, work_type, sort_order').order('sort_order', { ascending: true });
  if (!rows?.length && !error) {
    await seedDefaultBaysIfEmpty();
    const retry = await supabase.from('bays').select('id, name, work_type, sort_order').order('sort_order', { ascending: true });
    rows = retry.data ?? [];
    error = retry.error ?? null;
  }
  if (error) {
    console.error('getBays:', error);
    return [];
  }
  if (!rows?.length) return [];

  bayNumberToUuid = new Map();
  bayUuidToNumber = new Map();
  const result: Bay[] = rows.map((row: { id: string; name: string; work_type: string }, i: number) => {
    const num = i + 1;
    bayNumberToUuid.set(num, row.id);
    bayUuidToNumber.set(row.id, num);
    return { id: num, name: row.name, workType: row.work_type as WorkType };
  });
  return result;
}

export function getCalendarEvents(initial: CalendarEvent[]): CalendarEvent[] {
  return getItem<CalendarEvent[]>(KEYS.calendar, initial);
}

export function setCalendarEvents(events: CalendarEvent[]): void {
  setItem(KEYS.calendar, events);
}

export function getColumnOrders(keys: ColumnOrderKey): ROStatus[] {
  return getItem<ROStatus[]>(KEYS[keys], []);
}

export function setColumnOrder(key: ColumnOrderKey, order: ROStatus[]): void {
  setItem(KEYS[key], order);
}

export function getCollapsedSections(initial: ROStatus[]): ROStatus[] {
  return getItem<ROStatus[]>(KEYS.collapsed, initial);
}

export function setCollapsedSections(sections: ROStatus[]): void {
  setItem(KEYS.collapsed, sections);
}

export function getSavedRole(): string | null {
  return localStorage.getItem(KEYS.role);
}

export function setSavedRole(role: string): void {
  localStorage.setItem(KEYS.role, role);
}

export function getSavedWorkType(): string | null {
  return localStorage.getItem(KEYS.workType);
}

export function setSavedWorkType(workType: string): void {
  localStorage.setItem(KEYS.workType, workType);
}

/**
 * History = records that are archived (DONE + payment settled in DB, deserialized as ARCHIVED).
 */
export function getHistory(ros: RepairOrder[], workType: WorkType): RepairOrder[] {
  return ros.filter(
    (ro) =>
      ro.workType === workType &&
      ro.status === ROStatus.ARCHIVED &&
      ro.settledAt != null &&
      (ro.paymentMethod === 'CASH' || ro.paymentMethod === 'CHEQUE' || ro.paymentMethod === 'ABANDONED')
  );
}

// --- Action-based writes (DB is source of truth; caller updates state after success) ---

async function ensureBayMapping(): Promise<void> {
  if (!supabase || bayNumberToUuid.size > 0) return;
  let { data: rows } = await supabase.from('bays').select('id, sort_order').order('sort_order', { ascending: true });
  if (!rows?.length) {
    await seedDefaultBaysIfEmpty();
    const retry = await supabase.from('bays').select('id, sort_order').order('sort_order', { ascending: true });
    rows = retry.data ?? [];
  }
  (rows ?? []).forEach((b: { id: string }, i: number) => {
    const num = i + 1;
    bayNumberToUuid.set(num, b.id);
    bayUuidToNumber.set(b.id, num);
  });
}

export async function createRepairOrder(ro: RepairOrder): Promise<RepairOrder> {
  if (!supabase) {
    setItem(KEYS.ros, getItem<RepairOrder[]>(KEYS.ros, []).concat(ro));
    return ro;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
  if (!profile?.shop_id) throw new Error('No shop_id');
  const payload = { shop_id: profile.shop_id, ...serializeRepairOrderForDB(ro) };
  const { data: inserted, error } = await supabase.from('repair_orders').insert(payload).select('id').single();
  if (error || !inserted?.id) throw error ?? new Error('Insert failed');
  const roId = inserted.id;
  const toInsert: { repair_order_id: string; entry_type: 'activity' | 'diagnostic'; type: string; text: string; created_at: string; image_storage_path?: string }[] = [];
  (ro.logs ?? []).forEach(log => toInsert.push({ repair_order_id: roId, entry_type: 'activity', type: log.type, text: log.text, created_at: log.timestamp, image_storage_path: log.imageUrl }));
  (ro.aiChat ?? []).forEach(log => toInsert.push({ repair_order_id: roId, entry_type: 'diagnostic', type: log.type, text: log.text, created_at: log.timestamp, image_storage_path: log.imageUrl }));
  if (toInsert.length) await supabase.from('event_log').insert(toInsert);
  return { ...ro, id: roId };
}

export async function updateRepairOrder(id: string, updates: RepairOrderUpdate): Promise<void> {
  if (!supabase) return;
  const payload = serializeRepairOrderUpdate(updates);
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from('repair_orders').update(payload).eq('id', id);
  if (error) throw error;
}

export async function addLogEntry(
  roId: string,
  entry: { type: LogEntry['type']; text: string; entry_type: 'activity' | 'diagnostic'; imageUrl?: string }
): Promise<LogEntry> {
  if (!supabase) {
    return { id: '', timestamp: new Date().toISOString(), user: '', text: entry.text, type: entry.type, imageUrl: entry.imageUrl };
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from('event_log')
    .insert({
      repair_order_id: roId,
      entry_type: entry.entry_type,
      type: entry.type,
      text: entry.text,
      image_storage_path: entry.imageUrl ?? null,
      user_id: user?.id ?? null,
    })
    .select('id, type, text, created_at, image_storage_path, user_id, profiles(role)')
    .single();
  if (error || !row) throw error ?? new Error('Insert failed');
  return eventLogToLogEntry(row);
}

export async function assignBay(roId: string, bayId: number | null, options: { totalTimeInBayMs: number; lastEnteredBayAt?: number }): Promise<void> {
  if (!supabase) return;
  await ensureBayMapping();
  const bayUuid = bayId != null ? bayNumberToUuid.get(bayId) ?? null : null;
  const payload: Record<string, unknown> = {
    bay_id: bayUuid,
    total_time_in_bay_ms: toNullable(options.totalTimeInBayMs) ?? 0,
    last_entered_bay_at: toNullable(options.lastEnteredBayAt != null ? new Date(options.lastEnteredBayAt).toISOString() : null),
  };
  const { error } = await supabase.from('repair_orders').update(payload).eq('id', roId);
  if (error) throw error;
}
