
export type Role = 'ADVISOR' | 'FOREMAN' | 'OWNER';
export type WorkType = 'MECHANIC' | 'BODY';

export enum ROStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING = 'PENDING',
  DONE = 'DONE',
  INSURANCE = 'INSURANCE',
  BODY_WORK = 'BODY_WORK',
  PAINTING = 'PAINTING',
  FINISHING_UP = 'FINISHING_UP',
  MECHANIC_WORK = 'MECHANIC_WORK',
  ORDER_LIST = 'ORDER_LIST',
  ARCHIVED = 'ARCHIVED'
}

/** Only these statuses are stored in repair_orders.status. Used for column order and kanban; ARCHIVED/INSURANCE/ORDER_LIST are display-only or derived. */
export const STORED_STATUSES: ROStatus[] = [
  ROStatus.TODO,
  ROStatus.PENDING,
  ROStatus.IN_PROGRESS,
  ROStatus.DONE,
  ROStatus.BODY_WORK,
  ROStatus.PAINTING,
  ROStatus.FINISHING_UP,
  ROStatus.MECHANIC_WORK,
];

export type PaymentMethod = 'CASH' | 'CHEQUE' | 'ABANDONED';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  data?: string; // Base64 or object URL for demo
}

export interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  text: string;
  type: 'SYSTEM' | 'USER' | 'AI';
  imageUrl?: string;
}

export interface RepairOrder {
  id: string;
  model: string;
  vin: string;
  customerName: string;
  phone: string;
  info: string;
  status: ROStatus;
  urgent: boolean;
  order: number;
  gridPosition?: number; 
  lastReadInfo: Record<string, string>; 
  bayId?: number;
  totalTimeInBay: number; 
  lastEnteredBayAt?: number;
  unreadBy: string[]; 
  paymentMethod?: PaymentMethod;
  paymentAmount?: number;
  settledAt?: string; 
  logs: LogEntry[];
  aiChat: LogEntry[]; // Separate storage for AI diagnostic chat
  isInsuranceCase?: boolean; // Persistent flag
  attachments?: Attachment[];
  calendarEventId?: string; // To link back to calendar
  mileage?: number; // Added mileage field
  deliveryDate?: string; // Added delivery date field
  crossShopActive?: boolean; // Whether it's currently being handled by the other shop
  secondaryStatus?: ROStatus; // Status in the other shop
  workType: WorkType; // Identifies which module the RO belongs to
  decodedData?: {
    year?: string;
    make?: string;
    model?: string;
    engine?: string;
    trim?: string;
    transmission?: string;
    drivetrain?: string;
    bodyStyle?: string;
    plant?: string;
    decodedAt?: string;
  };
}

export interface Bay {
  id: number;
  name: string;
  currentROId?: string;
  workType: WorkType;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string; // ISO string
  end: string;   // ISO string
}

export const RO_STATUS_LABELS: Record<ROStatus, string> = {
  [ROStatus.TODO]: 'To-do',
  [ROStatus.IN_PROGRESS]: 'In Progress',
  [ROStatus.PENDING]: 'Pending',
  [ROStatus.DONE]: 'Done',
  [ROStatus.INSURANCE]: 'Insurance',
  [ROStatus.BODY_WORK]: 'Body Work',
  [ROStatus.PAINTING]: 'Painting',
  [ROStatus.FINISHING_UP]: 'Finishing Up',
  [ROStatus.MECHANIC_WORK]: 'Mechanic Work',
  [ROStatus.ORDER_LIST]: 'Order List',
  [ROStatus.ARCHIVED]: 'Archived'
};