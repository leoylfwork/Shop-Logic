
import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { 
  Wrench, 
  Clock, 
  Search, 
  Plus, 
  LayoutDashboard,
  LayoutGrid,
  Activity,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  DollarSign,
  AlertTriangle,
  PanelLeftOpen,
  Camera,
  ImageIcon,
  Trash2,
  RotateCcw,
  Ban,
  Pencil,
  Check,
  Filter,
  Calendar as CalendarIcon,
  Wallet,
  Banknote,
  Coins,
  History,
  GripVertical,
  Timer,
  MoreVertical,
  Zap,
  FileText,
  UploadCloud,
  Shield,
  ShieldCheck,
  Paperclip,
  ExternalLink,
  X,
  Maximize2,
  Download,
  ArrowLeft,
  Info,
  MessageSquare,
  Car,
  Settings,
  RefreshCcw,
  Clock3,
  Cpu,
  ZapOff,
  Navigation,
  Layers,
  Megaphone,
  LogOut,
  Mail
} from 'lucide-react';
import { 
  ROStatus, 
  RepairOrder, 
  Role, 
  LogEntry, 
  Bay,
  RO_STATUS_LABELS,
  Attachment,
  CalendarEvent,
  WorkType,
  STORED_STATUSES
} from './types';
import { getDiagnosticAdvice, decodeVIN, type DiagnosticContext } from './services/ai';
import { useAuth } from './services/authContext';
import { createRepairOrder, updateRepairOrder, addLogEntry, assignBay, getRepairOrders, getBays, type RepairOrderUpdate } from './services/supabase';
import { supabase } from './services/supabaseClient';
import { canAssignBay, canBroadcast, canChangePayment, canChangeStatus, canCreateOrder, canSeeActiveBays } from './services/capabilities';
import { useCurrentUserRole } from './lib/hooks/useCurrentUserRole';

const INITIAL_ROS: RepairOrder[] = [
  {
    id: 'RO-101',
    model: '2018 BMW M3',
    vin: 'WBS3B9C5XJK0000',
    customerName: 'John Doe',
    phone: '555-0123',
    info: 'Turbo underboost error P0299\nCheck wastegate actuator',
    status: ROStatus.TODO,
    urgent: true,
    order: 0,
    gridPosition: 0,
    lastReadInfo: { ADVISOR: 'Turbo underboost error P0299\nCheck wastegate actuator', FOREMAN: '', OWNER: '' },
    totalTimeInBay: 0,
    unreadBy: ['FOREMAN'],
    logs: [{ id: '1', timestamp: new Date().toISOString(), user: 'Advisor', text: 'Vehicle registered.', type: 'SYSTEM' }],
    aiChat: [],
    mileage: 42500,
    workType: 'MECHANIC'
  }
];

const INITIAL_BAYS: Bay[] = [
  { id: 1, name: 'Bay 1', workType: 'MECHANIC' },
  { id: 2, name: 'Bay 2', workType: 'MECHANIC' },
  { id: 3, name: 'Bay 3', workType: 'MECHANIC' },
  { id: 4, name: 'Bay 4', workType: 'MECHANIC' },
  { id: 5, name: 'Bay 5', workType: 'MECHANIC' },
  { id: 6, name: 'Oil Changer', workType: 'MECHANIC' },
  { id: 7, name: 'Body Work', workType: 'BODY' },
  { id: 8, name: 'Painting and Prep', workType: 'BODY' },
  { id: 9, name: 'Mechanic Shop To-do', workType: 'BODY' },
];

/** Mechanic kanban columns (STATUS_SPEC): only these 5 stored statuses. */
const DEFAULT_ADVISOR_ORDER = [ROStatus.DONE, ROStatus.TODO, ROStatus.PENDING, ROStatus.IN_PROGRESS, ROStatus.BODY_WORK];
const DEFAULT_FOREMAN_ORDER = [ROStatus.DONE, ROStatus.TODO, ROStatus.IN_PROGRESS, ROStatus.PENDING, ROStatus.BODY_WORK];
const DEFAULT_OWNER_ORDER = [ROStatus.DONE, ROStatus.TODO, ROStatus.PENDING, ROStatus.IN_PROGRESS, ROStatus.BODY_WORK];

// "Done" is first, "Mechanic Work" added to the bottom
/** Body shop kanban columns (STATUS_SPEC): only these 6 stored statuses. */
const DEFAULT_BODY_SHOP_ORDER = [ROStatus.DONE, ROStatus.TODO, ROStatus.BODY_WORK, ROStatus.PAINTING, ROStatus.FINISHING_UP, ROStatus.MECHANIC_WORK];

const formatMs = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

/** Assign cards to slots: explicit gridPosition first, then fill remaining in stable order. Prevents duplicate gridPosition from hiding cards. */
function assignCardsToSlots(sectionItems: RepairOrder[], gridCount: number): (RepairOrder | undefined)[] {
  const sorted = [...sectionItems].sort((a, b) => {
    const ap = a.gridPosition ?? Infinity;
    const bp = b.gridPosition ?? Infinity;
    if (ap !== bp) return ap - bp;
    return a.order - b.order || a.id.localeCompare(b.id);
  });
  const result: (RepairOrder | undefined)[] = Array.from({ length: gridCount });
  const used = new Set<string>();
  for (const ro of sorted) {
    if (ro.gridPosition != null && ro.gridPosition >= 0 && ro.gridPosition < gridCount && !result[ro.gridPosition]) {
      result[ro.gridPosition] = ro;
      used.add(ro.id);
    }
  }
  let slot = 0;
  for (const ro of sorted) {
    if (used.has(ro.id)) continue;
    while (slot < gridCount && result[slot] != null) slot++;
    if (slot < gridCount) {
      result[slot] = ro;
      used.add(ro.id);
      slot++;
    }
  }
  return result;
}

export default function App() {
  const auth = useAuth();
  const { role: currentUserRole, loading: roleLoading } = useCurrentUserRole();
  const [workType, setWorkType] = useState<WorkType>(() => {
    const saved = localStorage.getItem('ck_flow_work_type');
    return (saved as WorkType) || 'MECHANIC';
  });

  const [userRole, setUserRole] = useState<Role>(() => {
    const saved = localStorage.getItem('ck_flow_role');
    const initialRole = (saved as Role) || 'ADVISOR';
    const savedWorkType = localStorage.getItem('ck_flow_work_type');
    if (savedWorkType === 'BODY') return 'OWNER';
    if (savedWorkType === 'MECHANIC' && initialRole === 'OWNER') return 'ADVISOR';
    return initialRole;
  });

  // Keep role aligned with authenticated role in mechanic mode.
  // Body shop is visible to all roles; no forced role switching there.
  useEffect(() => {
    if (workType === 'BODY') {
      setIsPlannerOpen(true);
      return;
    }
    if (workType !== 'MECHANIC') return;
    if (currentUserRole === 'advisor' && userRole !== 'ADVISOR') setUserRole('ADVISOR');
    if (currentUserRole === 'foreman' && userRole !== 'FOREMAN') setUserRole('FOREMAN');
    if (currentUserRole === 'owner' && userRole === 'OWNER') setUserRole('ADVISOR');
  }, [workType, currentUserRole, userRole]);

  const [ros, setRos] = useState<RepairOrder[]>(() => {
    const saved = localStorage.getItem('ck_flow_ros_v14');
    const data = saved ? JSON.parse(saved) : INITIAL_ROS;
    // Migration: Ensure all ROs have a workType
    return data.map((ro: any) => ({
      ...ro,
      workType: ro.workType || 'MECHANIC',
      status: ro.status === ROStatus.INSURANCE ? ROStatus.BODY_WORK : ro.status,
      isInsuranceCase: ro.status === ROStatus.INSURANCE ? true : ro.isInsuranceCase,
    }));
  });
  const [bays, setBays] = useState<Bay[]>(() => {
    const saved = localStorage.getItem('ck_flow_bays_v14');
    let data = saved ? JSON.parse(saved) : INITIAL_BAYS;
    
    // Migration: Ensure all bays from INITIAL_BAYS are present and have correct names
    const existingIds = new Set(data.map((b: any) => b.id));
    const missingBays = INITIAL_BAYS.filter(b => !existingIds.has(b.id));
    if (missingBays.length > 0) {
      data = [...data, ...missingBays];
    }

    // Sync names from INITIAL_BAYS for specific IDs
    data = data.map((bay: any) => {
      const initial = INITIAL_BAYS.find(ib => ib.id === bay.id);
      if (initial) return { ...bay, name: initial.name, workType: initial.workType };
      return bay;
    });

    return data;
  });
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => {
    const saved = localStorage.getItem('ck_flow_calendar_v3');
    return saved ? JSON.parse(saved) : [];
  });
  
  /** Sanitize saved column order: only stored statuses; INSURANCE→BODY_WORK; drop ARCHIVED/ORDER_LIST. */
  const sanitizeColumnOrder = (parsed: ROStatus[], defaultOrder: ROStatus[]): ROStatus[] => {
    const mapped = parsed.map(s => (s === ROStatus.INSURANCE ? ROStatus.BODY_WORK : s));
    const filtered = mapped.filter(s => STORED_STATUSES.includes(s));
    if (filtered.length === 0) return defaultOrder;
    const seen = new Set<ROStatus>();
    const deduped = filtered.filter(s => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
    return deduped.length ? deduped : defaultOrder;
  };

  const [advisorOrder, setAdvisorOrder] = useState<ROStatus[]>(() => {
    const saved = localStorage.getItem('ck_flow_order_advisor_v5');
    const parsed: ROStatus[] = saved ? JSON.parse(saved) : DEFAULT_ADVISOR_ORDER;
    return sanitizeColumnOrder(parsed, DEFAULT_ADVISOR_ORDER);
  });
  
  const [foremanOrder, setForemanOrder] = useState<ROStatus[]>(() => {
    const saved = localStorage.getItem('ck_flow_order_foreman_v5');
    const parsed: ROStatus[] = saved ? JSON.parse(saved) : DEFAULT_FOREMAN_ORDER;
    return sanitizeColumnOrder(parsed, DEFAULT_FOREMAN_ORDER);
  });

  const [ownerOrder, setOwnerOrder] = useState<ROStatus[]>(() => {
    const saved = localStorage.getItem('ck_flow_order_owner_v5');
    const parsed: ROStatus[] = saved ? JSON.parse(saved) : DEFAULT_OWNER_ORDER;
    return sanitizeColumnOrder(parsed, DEFAULT_OWNER_ORDER);
  });

  const [bodyShopOrder, setBodyShopOrder] = useState<ROStatus[]>(() => {
    const saved = localStorage.getItem('ck_flow_order_body_v5');
    const parsed: ROStatus[] = saved ? JSON.parse(saved) : DEFAULT_BODY_SHOP_ORDER;
    return sanitizeColumnOrder(parsed, DEFAULT_BODY_SHOP_ORDER);
  });

  const [collapsedSections, setCollapsedSections] = useState<ROStatus[]>(() => {
    const saved = localStorage.getItem('ck_flow_collapsed_v2');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedROId, setSelectedROId] = useState<string | null>(null);
  const [view, setView] = useState<'DASHBOARD' | 'ARCHIVE' | 'CALENDAR' | 'ALL'>('DASHBOARD');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewRODialog, setShowNewRODialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState<string | null>(null);
  const [showBayConflictDialog, setShowBayConflictDialog] = useState<{ newROId: string, bayId: number } | null>(null);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  const [showBroadcastInput, setShowBroadcastInput] = useState(false);
  const [showSentToast, setShowSentToast] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const canAccessAdvisorMode = currentUserRole === 'advisor' || currentUserRole === 'owner';
  const canAccessForemanMode = currentUserRole === 'foreman' || currentUserRole === 'owner';
  const isMechanicModeUnauthorized =
    workType === 'MECHANIC' &&
    ((userRole === 'ADVISOR' && !canAccessAdvisorMode) || (userRole === 'FOREMAN' && !canAccessForemanMode));

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'BROADCAST') {
          setBroadcastMessage(data.payload);
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    return () => socket.close();
  }, []);

  const sendBroadcast = (text: string) => {
    if (!canBroadcast(userRole)) {
      console.warn('[capabilities] sendBroadcast: not allowed for role', userRole);
      return;
    }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'BROADCAST', payload: text }));
      setShowSentToast(true);
      setTimeout(() => setShowSentToast(false), 3000);
    }
  };

  const clearBroadcast = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'CLEAR_BROADCAST' }));
    }
  };
  const [isScanning, setIsScanning] = useState(false);
  const [draggedSection, setDraggedSection] = useState<ROStatus | null>(null);
  const [isMobileSearchVisible, setIsMobileSearchVisible] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const createROInFlightRef = useRef(false);

  const refetchRosAndBays = async () => {
    if (!supabase) return;
    const [freshRos, freshBays] = await Promise.all([
      getRepairOrders([]),
      getBays(INITIAL_BAYS),
    ]);
    setRos(freshRos);
    setBays(freshBays.map(b => ({ ...b, currentROId: freshRos.find(r => r.bayId === b.id)?.id })));
  };

  useEffect(() => {
    try {
      localStorage.setItem('ck_flow_ros_v14', JSON.stringify(ros));
      localStorage.setItem('ck_flow_bays_v14', JSON.stringify(bays));
      localStorage.setItem('ck_flow_calendar_v3', JSON.stringify(calendarEvents));
      localStorage.setItem('ck_flow_order_advisor_v5', JSON.stringify(advisorOrder));
      localStorage.setItem('ck_flow_order_foreman_v5', JSON.stringify(foremanOrder));
      localStorage.setItem('ck_flow_order_owner_v5', JSON.stringify(ownerOrder));
      localStorage.setItem('ck_flow_order_body_v5', JSON.stringify(bodyShopOrder));
      localStorage.setItem('ck_flow_collapsed_v2', JSON.stringify(collapsedSections));
      localStorage.setItem('ck_flow_role', userRole);
      localStorage.setItem('ck_flow_work_type', workType);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.error('CRITICAL: LocalStorage quota exceeded. The application cannot save new data. Please use the "Reset Data" button in the header or delete old orders/history to free up space.');
        // Optionally show a non-intrusive notification to the user
      } else {
        console.error('Failed to save to localStorage:', e);
      }
    }
  }, [ros, bays, calendarEvents, advisorOrder, foremanOrder, ownerOrder, bodyShopOrder, collapsedSections, userRole, workType]);

  /** Initial load: sync ROS and bays from DB so new browser / cleared cache shows correct data. */
  const initialRefetchDoneRef = useRef(false);
  useEffect(() => {
    if (!supabase || initialRefetchDoneRef.current) return;
    initialRefetchDoneRef.current = true;
    refetchRosAndBays();
  }, [supabase]);

  /** Supabase Realtime: subscribe to repair_orders so other clients' changes are reflected. */
  const refetchRosAndBaysRef = useRef(refetchRosAndBays);
  refetchRosAndBaysRef.current = refetchRosAndBays;
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const onRealtimeChange = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null;
        refetchRosAndBaysRef.current();
      }, 600);
    };
    const channel = client
      .channel('ck-flow-repair-orders')
      .on(
        'postgres_changes',
        { schema: 'public', table: 'repair_orders', event: '*' },
        onRealtimeChange
      )
      .on(
        'postgres_changes',
        { schema: 'public', table: 'event_log', event: 'INSERT' },
        onRealtimeChange
      )
      .subscribe();
    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      client.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRos(prev => prev.map(ro => {
        if (ro.status === ROStatus.IN_PROGRESS && ro.lastEnteredBayAt) return { ...ro }; 
        return ro;
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * ZERO-TOUCH SYNC LOGIC
   */
  useEffect(() => {
    const performZeroTouchSync = () => {
      const today = new Date().toDateString();
      
      setRos(prevRos => {
        let changed = false;
        let updatedRos = [...prevRos];

        calendarEvents.forEach(event => {
          const eventDate = new Date(event.start).toDateString();
          
          if (eventDate === today) {
            const existingRO = updatedRos.find(r => r.calendarEventId === event.id);
            
            if (!existingRO) {
              const newRO: RepairOrder = {
                id: `CAL-${event.id.slice(0, 4).toUpperCase()}`,
                model: event.title,
                vin: 'CALENDAR_SYNC',
                customerName: 'Schedule Entry',
                phone: 'N/A',
                info: event.description || 'Synced from Calendar',
                status: ROStatus.TODO, // Defaults to TODO
                urgent: false,
                order: updatedRos.length,
                lastReadInfo: { ADVISOR: '', FOREMAN: '', OWNER: '' },
                totalTimeInBay: 0,
                unreadBy: ['ADVISOR', 'FOREMAN', 'OWNER'],
                logs: [{ 
                  id: Math.random().toString(36).substr(2, 9), 
                  timestamp: new Date().toISOString(), 
                  user: 'SYSTEM', 
                  text: 'Zero-Touch: Auto-synced from Calendar for today.', 
                  type: 'SYSTEM' 
                }],
                aiChat: [],
                calendarEventId: event.id,
                workType: workType // Sycned to current module
              };
              updatedRos.push(newRO);
              changed = true;
            } else {
              if (existingRO.model !== event.title || existingRO.info !== event.description) {
                updatedRos = updatedRos.map(r => 
                  r.calendarEventId === event.id 
                    ? { ...r, model: event.title, info: event.description } 
                    : r
                );
                changed = true;
              }
            }
          }
        });

        return changed ? updatedRos : prevRos;
      });
    };

    performZeroTouchSync();
  }, [calendarEvents, workType]);

  const currentRO = useMemo(() => ros.find(r => r.id === selectedROId), [ros, selectedROId]);

  const toggleSection = (status: ROStatus) => {
    setCollapsedSections(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status) 
        : [...prev, status]
    );
  };

  const addLog = (roId: string, text: string, type: LogEntry['type'] = 'USER', imageUrl?: string) => {
    if (supabase) {
      addLogEntry(roId, { type, text, entry_type: 'activity', imageUrl })
        .then(() => refetchRosAndBays())
        .catch((e) => console.error('addLogEntry:', e));
      return;
    }
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      user: userRole,
      text,
      type,
      imageUrl
    };
    setRos(prev => prev.map(ro => {
      if (ro.id === roId) {
        const targetRoles = ['ADVISOR', 'FOREMAN', 'OWNER'].filter(r => r !== userRole);
        const newUnreadBy = [...new Set([...ro.unreadBy, ...targetRoles])];
        return { ...ro, logs: [...ro.logs, newLog], unreadBy: newUnreadBy };
      }
      return ro;
    }));
  };

  const addAiLog = (roId: string, text: string, type: LogEntry['type'] = 'USER', imageUrl?: string) => {
    if (supabase) {
      addLogEntry(roId, { type, text, entry_type: 'diagnostic', imageUrl })
        .then(() => refetchRosAndBays())
        .catch((e) => console.error('addLogEntry:', e));
      return;
    }
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      user: userRole,
      text,
      type,
      imageUrl
    };
    setRos(prev => prev.map(ro => {
      if (ro.id === roId) {
        const targetRoles = ['ADVISOR', 'FOREMAN', 'OWNER'].filter(r => r !== userRole);
        const newUnreadBy = [...new Set([...ro.unreadBy, ...targetRoles])];
        return { ...ro, aiChat: [...(ro.aiChat || []), newLog], unreadBy: newUnreadBy };
      }
      return ro;
    }));
  };

  const updateRO = (id: string, updates: Partial<RepairOrder>) => {
    const ro = ros.find(r => r.id === id);
    if (!ro) return;

    if (updates.status !== undefined && !canChangeStatus(userRole)) {
      console.warn('[capabilities] updateRO status: not allowed for role', userRole);
      return;
    }
    const hasPaymentUpdate = updates.paymentMethod !== undefined || updates.paymentAmount !== undefined || updates.settledAt !== undefined;
    if (hasPaymentUpdate && !canChangePayment(userRole)) {
      console.warn('[capabilities] updateRO payment: not allowed for role', userRole);
      return;
    }

    const fieldLogs: string[] = [];
    if (updates.id !== undefined && updates.id !== ro.id) fieldLogs.push(`RO changed: ${ro.id} → ${updates.id}`);
    if (updates.model !== undefined && updates.model !== ro.model) fieldLogs.push(`Model updated: ${updates.model}`);
    if (updates.vin !== undefined && updates.vin !== ro.vin) fieldLogs.push(`VIN updated: ${updates.vin}`);
    if (updates.customerName !== undefined && updates.customerName !== ro.customerName) fieldLogs.push(`Customer: ${updates.customerName}`);
    if (updates.phone !== undefined && updates.phone !== ro.phone) fieldLogs.push(`Phone: ${updates.phone}`);
    if (updates.urgent !== undefined && updates.urgent !== ro.urgent) fieldLogs.push(`Priority: ${updates.urgent ? 'URGENT' : 'NORMAL'}`);
    if (updates.mileage !== undefined && updates.mileage !== ro.mileage) fieldLogs.push(`Odometer updated: ${updates.mileage} km`);
    
    if (updates.status !== undefined && updates.status !== ro.status) {
        const currentLabels = getStatusLabels(workType);
        fieldLogs.push(`Workflow updated: ${currentLabels[ro.status]} → ${currentLabels[updates.status]}`);
        if (ro.bayId !== undefined && updates.status !== ro.status) {
            leaveBay(id, updates.status);
            return;
        }
    }

    const dbUpdates: RepairOrderUpdate = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.paymentMethod !== undefined) dbUpdates.paymentMethod = updates.paymentMethod;
    if (updates.paymentAmount !== undefined) dbUpdates.paymentAmount = updates.paymentAmount;
    if (updates.settledAt !== undefined) dbUpdates.settledAt = updates.settledAt;
    if (updates.model !== undefined) {
      dbUpdates.model = updates.model;
      if (updates.info === undefined) dbUpdates.info = ro.info;
    }
    if (updates.vin !== undefined) dbUpdates.vin = updates.vin;
    if (updates.customerName !== undefined) dbUpdates.customerName = updates.customerName;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.info !== undefined) {
      dbUpdates.info = updates.info;
      if (dbUpdates.model === undefined) dbUpdates.model = ro.model;
    }
    if (updates.urgent !== undefined) dbUpdates.urgent = updates.urgent;
    if (updates.mileage !== undefined) dbUpdates.mileage = updates.mileage;
    if (updates.deliveryDate !== undefined) dbUpdates.deliveryDate = updates.deliveryDate;
    if (updates.gridPosition !== undefined) dbUpdates.gridPosition = updates.gridPosition;
    if (updates.calendarEventId !== undefined) dbUpdates.calendarEventId = updates.calendarEventId;
    if (updates.isInsuranceCase !== undefined) dbUpdates.isInsuranceCase = updates.isInsuranceCase;
    if (updates.isInsuranceCase !== undefined) dbUpdates.isInsuranceCase = updates.isInsuranceCase;

    const applyState = () => {
      setRos(prev => prev.map(item => {
        if (item.id === id) {
          if (updates.id && updates.id !== id) {
            if (selectedROId === id) setSelectedROId(updates.id);
          }
          return { ...item, ...updates };
        }
        return item;
      }));
      fieldLogs.forEach(logText => addLog(updates.id || id, logText, 'SYSTEM'));
    };

    if (supabase && Object.keys(dbUpdates).length > 0) {
      updateRepairOrder(id, dbUpdates)
        .then(() => refetchRosAndBays())
        .then(() => { fieldLogs.forEach(logText => addLog(updates.id || id, logText, 'SYSTEM')); })
        .catch((e) => console.error('updateRepairOrder:', e));
      return;
    }
    applyState();
  };

  const markAsRead = (id: string) => {
    setRos(prev => prev.map(ro => {
      if (ro.id === id) {
        return { 
          ...ro, 
          unreadBy: ro.unreadBy.filter(r => r !== userRole),
          lastReadInfo: { ...ro.lastReadInfo, [userRole]: ro.info }
        };
      }
      return ro;
    }));
  };

  const handleMoveToSection = (roId: string, status: ROStatus, gridPosition?: number) => {
    if (!canChangeStatus(userRole)) {
      console.warn('[capabilities] handleMoveToSection: not allowed for role', userRole);
      return;
    }
    const ro = ros.find(r => r.id === roId);
    if (!ro) return;

    if (ro.bayId !== undefined && status !== ro.status) {
      leaveBay(roId, status);
      return;
    }

    const evictedId =
      gridPosition !== undefined
        ? ros.find(
            (r) => r.id !== roId && r.status === status && r.gridPosition === gridPosition
          )?.id
        : undefined;

    const applyOptimistic = () => {
      setRos((prev) =>
        prev.map((item) => {
          if (item.id === roId) return { ...item, status, gridPosition };
          if (item.id === evictedId && gridPosition !== undefined)
            return { ...item, gridPosition: undefined };
          return item;
        })
      );
    };

    if (supabase) {
      applyOptimistic();
      const payload: RepairOrderUpdate = { status };
      if (gridPosition !== undefined) payload.gridPosition = gridPosition;
      const promises: Promise<unknown>[] = [
        updateRepairOrder(roId, payload),
        ...(evictedId
          ? [updateRepairOrder(evictedId, { gridPosition: undefined })]
          : []),
      ];
      Promise.all(promises)
        .then(() => refetchRosAndBays())
        .then(() => {
          if (status !== ro.status) {
            const currentLabels = getStatusLabels(workType);
            addLog(roId, `Workflow updated: ${currentLabels[ro.status]} → ${currentLabels[status]}`, 'SYSTEM');
          }
        })
        .catch((e) => console.error('updateRepairOrder:', e));
      return;
    }
    applyOptimistic();
    if (status !== ro.status) {
      const currentLabels = getStatusLabels(workType);
      addLog(roId, `Workflow updated: ${currentLabels[ro.status]} → ${currentLabels[status]}`, 'SYSTEM');
    }
  };

  const handleDragToBay = (roId: string, bayId: number) => {
    if (!canAssignBay(userRole)) {
      console.warn('[capabilities] handleDragToBay: not allowed for role', userRole);
      return;
    }
    const targetBay = bays.find(b => b.id === bayId);
    if (targetBay?.currentROId && targetBay.currentROId !== roId) {
      setShowBayConflictDialog({ newROId: roId, bayId });
    } else {
      moveToBay(roId, bayId);
    }
  };

  const moveToBay = (roId: string, bayId: number) => {
    if (!canAssignBay(userRole)) {
      console.warn('[capabilities] moveToBay: not allowed for role', userRole);
      return;
    }
    const targetBay = bays.find(b => b.id === bayId);
    const ro = ros.find(r => r.id === roId);
    if (!ro) return;
    let nextStatus = ro.status;
    if (targetBay?.workType === 'MECHANIC') {
      nextStatus = ROStatus.IN_PROGRESS;
    } else if (targetBay?.workType === 'BODY') {
      if (bayId === 7) nextStatus = ROStatus.BODY_WORK;
      else if (bayId === 8) nextStatus = ROStatus.PAINTING;
      else if (bayId === 9) nextStatus = ROStatus.MECHANIC_WORK;
    }
    const timeInPrevBay = ro.lastEnteredBayAt ? Date.now() - ro.lastEnteredBayAt : 0;
    const newTotalMs = ro.totalTimeInBay + timeInPrevBay;
    const now = Date.now();

    if (supabase) {
      Promise.all([
        assignBay(roId, bayId, { totalTimeInBayMs: newTotalMs, lastEnteredBayAt: now }),
        updateRepairOrder(roId, { status: nextStatus }),
      ])
        .then(() => refetchRosAndBays())
        .then(() => addLog(roId, `Vehicle moved into ${targetBay?.name || `Bay ${bayId}`}`, 'SYSTEM'))
        .catch((e) => console.error('moveToBay:', e));
      return;
    }
    setRos(prev => prev.map(r => {
      if (r.id === roId) {
        return { ...r, status: nextStatus, bayId, lastEnteredBayAt: now, totalTimeInBay: newTotalMs, gridPosition: undefined };
      }
      return r;
    }));
    setBays(prev => prev.map(b => ({
      ...b,
      currentROId: b.id === bayId ? roId : (b.currentROId === roId ? undefined : b.currentROId)
    })));
    addLog(roId, `Vehicle moved into ${targetBay?.name || `Bay ${bayId}`}`, 'SYSTEM');
  };

  const leaveBay = (roId: string, nextStatus: ROStatus) => {
    if (!canAssignBay(userRole)) {
      console.warn('[capabilities] leaveBay: not allowed for role', userRole);
      return;
    }
    const ro = ros.find(r => r.id === roId);
    if (!ro) return;
    const timeSpent = ro.lastEnteredBayAt ? Date.now() - ro.lastEnteredBayAt : 0;
    const sessionDurationStr = formatMs(timeSpent);
    const totalLifetimeStr = formatMs(ro.totalTimeInBay + timeSpent);
    const newTotalMs = ro.totalTimeInBay + timeSpent;

    if (supabase) {
      Promise.all([
        assignBay(roId, null, { totalTimeInBayMs: newTotalMs }),
        updateRepairOrder(roId, { status: nextStatus }),
      ])
        .then(() => refetchRosAndBays())
        .then(() => addLog(roId, `Vehicle exited Bay. Session Time: ${sessionDurationStr} | Total Bay Time: ${totalLifetimeStr}`, 'SYSTEM'))
        .catch((e) => console.error('leaveBay:', e));
      return;
    }
    setRos(prev => prev.map(item => {
      if (item.id === roId) return { ...item, status: nextStatus, bayId: undefined, lastEnteredBayAt: undefined, totalTimeInBay: newTotalMs };
      return item;
    }));
    setBays(prev => prev.map(b => ({ ...b, currentROId: b.currentROId === roId ? undefined : b.currentROId })));
    addLog(roId, `Vehicle exited Bay. Session Time: ${sessionDurationStr} | Total Bay Time: ${totalLifetimeStr}`, 'SYSTEM');
  };

  const handleResolveConflict = (resolution: ROStatus) => {
    if (!showBayConflictDialog) return;
    const { newROId, bayId } = showBayConflictDialog;
    const oldROId = bays.find(b => b.id === bayId)?.currentROId;
    if (oldROId) leaveBay(oldROId, resolution);
    moveToBay(newROId, bayId);
    setShowBayConflictDialog(null);
  };

  // Filter ROs based on the selected WorkType (MECHANIC vs BODY)
  const filteredROs = useMemo(() => {
    const filteredByModule = ros.filter(ro => ro.workType === workType);
    const q = searchQuery.toLowerCase().trim();
    if (!q) return filteredByModule;
    const qRaw = q.replace(/\D/g, '');

    return filteredByModule.filter(ro => {
        const phoneRaw = ro.phone.replace(/\D/g, '');
        return (
            (qRaw && phoneRaw.includes(qRaw)) || 
            ro.customerName.toLowerCase().includes(q) || 
            ro.model.toLowerCase().includes(q) ||
            ro.id.toLowerCase().includes(q) ||
            ro.vin.toLowerCase().includes(q)
        );
    });
  }, [ros, searchQuery, workType]);

  const currentSectionOrder = useMemo(() => {
    let order: ROStatus[] = [];
    if (workType === 'BODY') order = bodyShopOrder;
    else if (userRole === 'ADVISOR') order = advisorOrder;
    else if (userRole === 'OWNER') order = ownerOrder;
    else order = foremanOrder;

    if (workType === 'MECHANIC') {
      return order.filter(s => [ROStatus.DONE, ROStatus.TODO, ROStatus.PENDING, ROStatus.IN_PROGRESS, ROStatus.BODY_WORK].includes(s));
    }
    return order.filter(s => [ROStatus.DONE, ROStatus.TODO, ROStatus.BODY_WORK, ROStatus.PAINTING, ROStatus.FINISHING_UP, ROStatus.MECHANIC_WORK].includes(s));
  }, [userRole, advisorOrder, foremanOrder, ownerOrder, bodyShopOrder, workType]);

  const handleSectionDrop = (targetStatus: ROStatus) => {
    if (!draggedSection || draggedSection === targetStatus) return;
    
    const updateOrder = (prevOrder: ROStatus[]) => {
      const newOrder = [...prevOrder];
      const draggedIdx = newOrder.indexOf(draggedSection);
      const targetIdx = newOrder.indexOf(targetStatus);
      
      if (draggedIdx === -1 || targetIdx === -1) return prevOrder;
      
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedSection);
      return newOrder;
    };
    
    if (workType === 'BODY') setBodyShopOrder(prev => updateOrder(prev));
    else if (userRole === 'ADVISOR') setAdvisorOrder(prev => updateOrder(prev));
    else if (userRole === 'OWNER') setOwnerOrder(prev => updateOrder(prev));
    else setForemanOrder(prev => updateOrder(prev));
    
    setDraggedSection(null);
  };

  const handleNoRepair = (id: string) => {
    addLog(id, `Settle: NO REPAIR (Abandoned)`, 'SYSTEM');
    updateRO(id, { 
      status: ROStatus.ARCHIVED, 
      paymentMethod: 'ABANDONED', 
      paymentAmount: 0, 
      settledAt: new Date().toISOString() 
    }); 
    setSelectedROId(null);
  }

  const getStatusStyles = (s: ROStatus) => {
    switch(s) {
      case ROStatus.DONE: return 'border-emerald-100 bg-[rgba(22,163,74,0.08)]';
      case ROStatus.IN_PROGRESS: return 'border-blue-100 bg-[rgba(37,99,235,0.08)]';
      case ROStatus.PENDING: return 'border-amber-100 bg-[rgba(234,88,12,0.08)]';
      case ROStatus.INSURANCE: return 'border-[#E2D8E2] bg-[rgba(107,76,122,0.08)]';
      case ROStatus.BODY_WORK: return 'border-[#D8C6E2] bg-[#F1E9F6]';
      case ROStatus.PAINTING: return 'border-yellow-100 bg-[rgba(250,204,21,0.08)]';
      case ROStatus.FINISHING_UP: return 'border-purple-100 bg-[rgba(168,85,247,0.08)]';
      case ROStatus.MECHANIC_WORK: return 'border-indigo-100 bg-[rgba(79,70,229,0.08)]';
      case ROStatus.ORDER_LIST: return 'border-teal-100 bg-[rgba(20,184,166,0.08)]';
      case ROStatus.TODO: return 'border-slate-200 bg-white';
      default: return 'border-slate-200 bg-white';
    }
  };

  const getHeaderColor = (s: ROStatus) => {
    switch(s) {
      case ROStatus.DONE: return 'text-emerald-700';
      case ROStatus.IN_PROGRESS: return 'text-blue-700';
      case ROStatus.PENDING: return 'text-amber-700';
      case ROStatus.INSURANCE: return 'text-[#6B4C7A]';
      case ROStatus.BODY_WORK: return 'text-[#6B4C7A]';
      case ROStatus.PAINTING: return 'text-yellow-700';
      case ROStatus.FINISHING_UP: return 'text-purple-700';
      case ROStatus.MECHANIC_WORK: return 'text-indigo-700';
      case ROStatus.ORDER_LIST: return 'text-teal-700';
      case ROStatus.TODO: return 'text-slate-500';
      default: return 'text-slate-500';
    }
  };

  const toggleMobileSearch = () => {
    setIsMobileSearchVisible(!isMobileSearchVisible);
    if (!isMobileSearchVisible) {
      setTimeout(() => mobileSearchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F5F7FA] text-slate-900">
      <header className="flex items-center px-4 md:px-6 py-3 bg-white border-b border-slate-200 shrink-0 z-30 shadow-sm relative h-16">
        {/* Mobile Search Overlay */}
        {isMobileSearchVisible && (
          <div className="absolute inset-0 bg-white z-40 flex items-center px-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <button onClick={toggleMobileSearch} className="p-2 mr-2 text-slate-400 hover:text-slate-900">
              <ArrowLeft size={20} />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                ref={mobileSearchInputRef}
                type="text" 
                placeholder="SEARCH VIN/MODEL..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                className="w-full pl-10 pr-4 py-2 rounded bg-slate-50 border border-slate-200 focus:border-blue-600 focus:ring-0 text-[12px] font-black uppercase tracking-wider" 
              />
            </div>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="p-2 ml-2 text-slate-400">
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* LEFT SECTION: LOGO + SHOP SWITCHER */}
        <div className="flex items-center gap-2 md:gap-4 w-12 md:w-[350px]">
          {/* Mobile Shop Switcher Icon */}
          <button 
            onClick={() => setWorkType(workType === 'MECHANIC' ? 'BODY' : 'MECHANIC')}
            className="md:hidden bg-slate-900 p-2 rounded text-white shadow-sm active:scale-95 transition-transform"
          >
            {workType === 'MECHANIC' ? <Wrench size={18} /> : <Car size={18} />}
          </button>

          <div className="hidden md:flex bg-slate-900 p-2 rounded text-white items-center gap-2 shrink-0">
            <Wrench size={18} />
          </div>
          <h1 className="text-lg font-black tracking-tighter text-slate-900 uppercase hidden lg:block whitespace-nowrap">CK-Flow <span className="text-blue-600">2.0</span></h1>
          
          <div className="hidden md:block relative group ml-2">
            <select 
              value={workType} 
              onChange={(e) => setWorkType(e.target.value as WorkType)}
              className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 pr-8 text-[10px] font-black uppercase tracking-wider text-slate-900 focus:ring-2 focus:ring-blue-600 transition-all cursor-pointer shadow-sm"
            >
              <option value="MECHANIC">Mechanic Shop</option>
              <option value="BODY">Body Shop</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-slate-400">
              <ChevronDown size={14} />
            </div>
          </div>
        </div>

        {/* CENTER SECTION: NAVIGATION GROUP */}
        <nav className="flex-1 flex items-center justify-center gap-0.5 md:gap-1">
          {workType === 'BODY' && (
            <button onClick={() => setView('ALL')} className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-lg transition-all text-xs font-black uppercase tracking-widest ${view === 'ALL' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
              <LayoutGrid size={14} /> <span className="hidden sm:inline">All</span>
            </button>
          )}
          
          <button onClick={() => setView('DASHBOARD')} className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-lg transition-all text-xs font-black uppercase tracking-widest ${view === 'DASHBOARD' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
            <LayoutDashboard size={14} /> <span className="hidden sm:inline">Workflow</span>
          </button>
          
          <button onClick={() => setView('CALENDAR')} className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-lg transition-all text-xs font-black uppercase tracking-widest ${view === 'CALENDAR' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
            <CalendarIcon size={14} /> <span className="hidden sm:inline">Calendar</span>
          </button>
          
          {canCreateOrder(userRole) && (
            <button onClick={() => setView('ARCHIVE')} className={`flex items-center gap-2 px-3 md:px-6 py-2 rounded-lg transition-all text-xs font-black uppercase tracking-widest ${view === 'ARCHIVE' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
              <History size={14} /> <span className="hidden sm:inline">History</span>
            </button>
          )}

          {/* Mobile Active Bays Toggle (Foreman/Owner only) */}
          {canSeeActiveBays(userRole) && workType === 'MECHANIC' && (
            <button 
              onClick={() => setIsPlannerOpen(!isPlannerOpen)} 
              className={`md:hidden flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-xs font-black uppercase tracking-widest ${isPlannerOpen ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
        </nav>

        {/* RIGHT SECTION: SEARCH + ROLE */}
        <div className="flex items-center justify-end gap-2 md:gap-4 w-12 md:w-[350px]">
          {(view === 'DASHBOARD' || view === 'CALENDAR') && (
            <div className="hidden md:flex relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={14} />
              <input type="text" placeholder="SEARCH VIN/MODEL..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 pr-4 py-2 rounded bg-slate-50 border border-slate-200 focus:border-blue-600 focus:ring-0 transition-all text-[10px] font-black w-32 lg:w-48 tracking-wider" />
            </div>
          )}
          
          <button 
            onClick={toggleMobileSearch}
            className="md:hidden h-10 w-10 flex items-center justify-center rounded-full bg-slate-50 border border-slate-200 text-slate-500 active:bg-slate-900 active:text-white transition-all shadow-sm"
          >
            <Search size={18} />
          </button>
          
          {workType === 'MECHANIC' && (
            <div className="hidden md:flex items-center gap-2">
              {canAccessAdvisorMode && (
                <button
                  type="button"
                  onClick={() => setUserRole('ADVISOR')}
                  className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 border rounded-lg transition-all ${
                    userRole === 'ADVISOR'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Advisor Mode
                </button>
              )}
              {canAccessForemanMode && (
                <button
                  type="button"
                  onClick={() => setUserRole('FOREMAN')}
                  className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 border rounded-lg transition-all ${
                    userRole === 'FOREMAN'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Foreman Mode
                </button>
              )}
            </div>
          )}

          {auth?.user?.email && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:flex items-center gap-1.5 text-slate-500 text-[10px] font-bold max-w-[140px] lg:max-w-[180px] truncate" title={auth.user.email}>
                <Mail size={12} className="text-slate-400 shrink-0" />
                <span className="truncate">{auth.user.email}</span>
              </span>
              <button
                type="button"
                onClick={() => auth?.signOut()}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}

        </div>
      </header>

      <main className="flex-1 overflow-hidden flex relative">
        {view === 'DASHBOARD' && canSeeActiveBays(userRole) && workType === 'MECHANIC' && (
          <aside className={`bg-slate-100 border-r border-slate-200 flex flex-col transition-all duration-300 ease-in-out shadow-sm z-20 ${isPlannerOpen ? 'fixed inset-0 md:relative md:w-[18rem]' : 'hidden md:flex md:w-12'}`}>
            <div className={`p-4 flex items-center ${isPlannerOpen ? 'justify-between' : 'justify-center'} border-b border-slate-200 bg-white md:bg-transparent`}>
              {isPlannerOpen && <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Bays</h3>}
              <button onClick={() => setIsPlannerOpen(!isPlannerOpen)} className="text-slate-400 hover:text-blue-600 transition p-1.5">
                {isPlannerOpen ? <X size={18} className="md:hidden" /> : null}
                <PanelLeftOpen size={18} className={isPlannerOpen ? 'hidden md:block' : ''} />
              </button>
            </div>
            {isPlannerOpen && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50">
                {bays.filter(b => b.workType === workType).map(bay => {
                  const ro = ros.find(r => r.id === bay.currentROId);
                  return (
                    <div 
                      key={bay.id} 
                      className={`relative p-4 rounded border-2 transition-all min-h-[120px] flex flex-col ${bay.currentROId ? 'border-slate-300 bg-white shadow-sm' : 'border-dashed border-slate-200 bg-transparent'}`} 
                      onDragOver={(e) => e.preventDefault()} 
                      onDrop={(e) => { 
                        const roId = e.dataTransfer.getData('roId'); 
                        if (roId) handleDragToBay(roId, bay.id); 
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{bay.name}</span>
                        {bay.currentROId && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                      </div>
                      {ro ? (
                        <div 
                          draggable 
                          onDragStart={(e) => e.dataTransfer.setData('roId', ro.id)}
                          onClick={() => { setSelectedROId(ro.id); markAsRead(ro.id); }}
                          className={`cursor-pointer group flex-1 flex flex-col p-2 rounded transition-all ${ro.urgent ? 'bg-red-50 border-l-4 border-red-600' : ''}`}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <h4 className={`text-[12px] font-black leading-tight tracking-tight ${ro.urgent ? 'text-red-700' : 'text-slate-900'}`}>{ro.model}</h4>
                          </div>
                          <div className="space-y-1 mb-auto">
                             {ro.info.split('\n').filter(Boolean).slice(0, 2).map((p, i) => (
                               <p key={i} className="text-[12px] text-slate-500 font-normal leading-relaxed">• {p}</p>
                             ))}
                          </div>
                          <div className="flex items-center gap-1.5 text-blue-600 mt-3 pt-3 border-t border-slate-100">
                            <Clock size={12} /><BayTimer ro={ro} />
                          </div>
                        </div>
                      ) : ( 
                        <div className="flex-1 flex items-center justify-center opacity-30">
                          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">VACANT</span> 
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {roleLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-slate-500 font-semibold">Loading…</p>
          </div>
        ) : isMechanicModeUnauthorized ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center max-w-lg">
              <h2 className="text-lg font-black uppercase tracking-wider text-slate-900 mb-2">Unauthorized</h2>
              <p className="text-sm text-slate-500 font-semibold">
                You do not have permission to access {userRole === 'ADVISOR' ? 'Advisor' : 'Foreman'} mode.
              </p>
            </div>
          </div>
        ) : view === 'DASHBOARD' ? (
          <div className="flex-1 flex flex-col overflow-y-auto p-4 md:p-6 custom-scrollbar">
            <div className="max-w-[1800px] mx-auto flex flex-col gap-10 pb-32 w-full">
              {currentSectionOrder.map((status) => {
                const sectionItems = filteredROs.filter(ro => ro.status === status);
                const isCollapsed = collapsedSections.includes(status);
                const gridCount = Math.max(8, Math.ceil(sectionItems.length / 8) * 8);
                const slotAssignments = assignCardsToSlots(sectionItems, gridCount);

                return (
                  <section 
                    key={status} 
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const sectionStatus = e.dataTransfer.getData('sectionStatus');
                      const roId = e.dataTransfer.getData('roId');
                      if (sectionStatus) {
                        handleSectionDrop(status);
                      } else if (roId) {
                        handleMoveToSection(roId, status);
                      }
                    }}
                    className={`flex flex-col transition-all duration-300 p-0 border-none shadow-none bg-transparent gap-4 ${draggedSection === status ? 'opacity-40 scale-[0.98] border-dashed border-slate-400' : ''}`}>
                    
                    <div className="flex items-center gap-4 px-2 shrink-0">
                      <div 
                        draggable 
                        onDragStart={(e) => { 
                          e.dataTransfer.setData('sectionStatus', status); 
                          setDraggedSection(status); 
                        }}
                        onDragEnd={() => setDraggedSection(null)}
                        className="text-slate-300 hover:text-slate-500 transition-colors p-1 cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical size={20} />
                      </div>
                      <h2 className={`text-xs font-black uppercase tracking-[0.2em] ${getHeaderColor(status)}`}>{getStatusLabels(workType)[status]}</h2>
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{sectionItems.length} UNITS</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleSection(status); }}
                        className="p-1.5 rounded bg-white border border-slate-200 text-slate-400 hover:text-blue-600 transition-all shadow-sm"
                      >
                        {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      </button>
                    </div>
                    
                    {!isCollapsed && (
                      <div className={`flex-1 overflow-y-auto custom-scrollbar pr-2 ${sectionItems.length > 0 ? 'pb-4' : 'pb-4'}`}>
                        {sectionItems.length === 0 ? (
                          <div className="py-8 border-2 border-dashed border-slate-100 rounded-xl flex items-center justify-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No units in this status</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3 content-start auto-rows-max">
                            {slotAssignments.map((roInSlot, idx) => (
                              <div 
                                key={roInSlot ? roInSlot.id : `empty-${status}-${idx}`} 
                                className={`relative min-h-[60px] md:aspect-square rounded border transition-colors overflow-hidden ${!roInSlot ? 'hidden md:block border-transparent bg-transparent' : 'border-transparent'}`} 
                                onDragOver={(e) => e.preventDefault()} 
                                onDrop={(e) => {
                                  const roId = e.dataTransfer.getData('roId');
                                  if (roId) { e.stopPropagation(); handleMoveToSection(roId, status, idx); }
                                }}
                              >
                                {roInSlot && (
                                  <KanbanCard 
                                      ro={roInSlot} 
                                      userRole={userRole} 
                                      userWorkType={workType}
                                      onClick={() => { setSelectedROId(roInSlot.id); markAsRead(roInSlot.id); }} 
                                      inInsuranceSection={status === ROStatus.BODY_WORK}
                                  />
                                )}
                              </div>
                            ))}
                        </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {(canCreateOrder(userRole) || workType === 'BODY') && (
              <button 
                onClick={() => setShowNewRODialog(true)} 
                className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-[50] btn-tactile flex items-center justify-center bg-slate-900 text-white rounded-full font-black shadow-xl border-b-4 border-slate-700 active:border-b-0 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95 w-14 h-14 md:w-auto md:h-auto md:px-8 md:py-5"
              >
                <Plus size={24} strokeWidth={3} />
                <span className="hidden md:block uppercase text-xs tracking-[0.2em] ml-3">NEW ORDER</span>
              </button>
            )}

            {canBroadcast(userRole) && workType === 'MECHANIC' && (
              <button 
                onClick={() => setShowBroadcastInput(true)} 
                className="fixed bottom-6 left-6 md:bottom-10 md:left-10 z-[50] btn-tactile flex items-center justify-center bg-blue-600 text-white rounded-full font-black shadow-xl border-b-4 border-blue-800 active:border-b-0 hover:bg-blue-700 transition-all hover:scale-105 active:scale-95 w-14 h-14 md:w-16 md:h-16"
                title="Send Broadcast to Foreman"
              >
                <Megaphone size={24} strokeWidth={3} />
              </button>
            )}

            {showSentToast && (
              <div className="fixed bottom-24 left-6 md:bottom-32 md:left-10 z-[100] bg-emerald-600 text-white px-6 py-3 rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300 flex items-center gap-3">
                <Check size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">Message Sent</span>
              </div>
            )}

            {broadcastMessage && userRole === 'FOREMAN' && (
              <div 
                onClick={clearBroadcast}
                className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-blue-600 text-white px-10 py-6 rounded-none shadow-2xl border-b-4 border-blue-800 animate-in slide-in-from-top-10 duration-300 cursor-pointer hover:scale-105 transition-all text-center min-w-[300px] max-w-[90vw]"
              >
                <p className="text-base font-black tracking-tight leading-tight">{broadcastMessage}</p>
              </div>
            )}

            {showBroadcastInput && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4">
                <div className="bg-white border border-slate-200 w-full max-w-md rounded-none overflow-hidden shadow-2xl animate-in zoom-in duration-300">
                  <div className="p-8">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter border-l-8 border-blue-600 pl-6">SEND MESSAGE TO THE TEAM</h3>
                      <button onClick={() => setShowBroadcastInput(false)} className="text-slate-400 hover:text-slate-900"><X size={24} /></button>
                    </div>
                    <textarea 
                      autoFocus
                      placeholder="Enter message for the team..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-none p-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 h-32 tracking-wider transition-all"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const val = (e.target as HTMLTextAreaElement).value;
                          if (val.trim()) {
                            sendBroadcast(val.trim());
                            setShowBroadcastInput(false);
                          }
                        }
                      }}
                    />
                    <div className="flex gap-3 mt-6">
                      <button 
                        onClick={() => setShowBroadcastInput(false)}
                        className="flex-1 py-4 rounded border border-slate-200 bg-slate-50 text-slate-400 font-black text-xs uppercase tracking-widest"
                      >
                        CANCEL
                      </button>
                      <button 
                        onClick={() => {
                          const textarea = document.querySelector('textarea');
                          if (textarea?.value.trim()) {
                            sendBroadcast(textarea.value.trim());
                            setShowBroadcastInput(false);
                          }
                        }}
                        className="flex-1 py-4 rounded bg-blue-600 text-white font-black text-xs uppercase tracking-widest border-b-4 border-blue-800 active:border-b-0"
                      >
                        SEND MESSAGE
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : view === 'ARCHIVE' ? (
          <OrderHistoryView 
            workType={workType}
            ros={ros.filter(r => r.status === ROStatus.ARCHIVED && r.workType === workType)} 
            onRestore={(id: string) => {
                updateRO(id, { status: ROStatus.TODO, paymentMethod: undefined, paymentAmount: undefined, settledAt: undefined });
                addLog(id, "Vehicle restored to workflow from History.", "SYSTEM");
            }} 
            onView={(id: string) => {
                setSelectedROId(id);
                markAsRead(id);
            }}
          />
        ) : view === 'ALL' ? (
          <AllRepairOrdersView 
            ros={ros.filter(r => r.workType === workType)} 
            onSelectRO={(id: string) => {
              setSelectedROId(id);
              markAsRead(id);
            }} 
            currentSectionOrder={currentSectionOrder}
            workType={workType}
            userRole={userRole}
            getStatusStyles={getStatusStyles}
            getHeaderColor={getHeaderColor}
          />
        ) : (
          <CalendarView 
            events={calendarEvents} 
            onAddEvent={(e) => setCalendarEvents([...calendarEvents, e])}
            onUpdateEvent={(e) => setCalendarEvents(calendarEvents.map(evt => evt.id === e.id ? e : evt))}
            onDeleteEvent={(id) => setCalendarEvents(calendarEvents.filter(evt => evt.id !== id))}
          />
        )}
      </main>

      {showBayConflictDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded p-8 max-sm w-full shadow-2xl animate-in zoom-in duration-200 text-center">
            <h3 className="text-xl font-black mb-4 flex items-center justify-center gap-3 uppercase text-amber-600 tracking-tighter"><AlertTriangle size={24} /> BAY CONFLICT</h3>
            <p className="text-[10px] font-black text-slate-500 mb-8 uppercase tracking-widest">
              {bays.find(b => b.id === showBayConflictDialog.bayId)?.name || `Bay ${showBayConflictDialog.bayId}`} is occupied. Update current vehicle status:
            </p>
            <div className="space-y-3">
              <button onClick={() => handleResolveConflict(ROStatus.DONE)} className="w-full py-4 rounded bg-emerald-600 text-white font-black text-xs uppercase tracking-widest border-b-4 border-emerald-800 active:border-b-0">MARK AS DONE</button>
              <button onClick={() => handleResolveConflict(ROStatus.PENDING)} className="w-full py-4 rounded border border-slate-200 bg-slate-50 text-slate-700 font-black text-xs uppercase tracking-widest">PENDING AREA</button>
              <button onClick={() => setShowBayConflictDialog(null)} className="w-full py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest mt-4">CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {selectedROId && currentRO && (
        <DetailModalWrapper 
          ro={currentRO} 
          userRole={userRole} 
          workType={workType}
          onClose={() => { markAsRead(currentRO.id); setSelectedROId(null); }} 
          onUpdate={(updates: any) => updateRO(currentRO.id, updates)} 
          onAddLog={(text: string, type: any, img: any) => addLog(currentRO.id, text, type, img)} 
          onAddAiLog={(text: string, type: any, img: any) => addAiLog(currentRO.id, text, type, img)}
          onShowPayment={() => setShowPaymentDialog(currentRO.id)} 
          onNoRepair={() => handleNoRepair(currentRO.id)}
          onScan={() => setIsScanning(true)}
          getHeaderColor={getHeaderColor}
          preventClose={!!showPaymentDialog}
        />
      )}

      {isScanning && ( <VINScanner onClose={() => setIsScanning(false)} onScan={(vin) => { if (currentRO) updateRO(currentRO.id, { vin }); setIsScanning(false); }} /> )}

      {showNewRODialog && ( <NewRODialog onClose={() => setShowNewRODialog(false)} onSubmit={(data) => {
            if (createROInFlightRef.current) return;
            if (supabase && !canCreateOrder(userRole)) {
              console.warn('[capabilities] createRepairOrder: not allowed for role', userRole);
              return;
            }
            const newROId = `RO-${Math.floor(1000 + Math.random() * 9000)}`;
            const infoPoints = (data.info || '').split('\n').filter(Boolean);
            const initialLogs: LogEntry[] = [
                { id: 'init', timestamp: new Date().toISOString(), user: 'Advisor', text: `Vehicle registered. ${data.urgent ? '[URGENT]' : '[NORMAL]'}`, type: 'SYSTEM' },
                ...infoPoints.map((p: string, idx: number) => ({
                    id: `info-init-${idx}`,
                    timestamp: new Date().toISOString(),
                    user: 'Advisor',
                    text: `Initial Info: ${p}`,
                    type: 'SYSTEM' as const
                }))
            ];

            const newRO: RepairOrder = {
              ...data,
              id: newROId,
              status: ROStatus.TODO,
              order: ros.length,
              lastReadInfo: { ADVISOR: data.info || '', FOREMAN: '', OWNER: '' },
              totalTimeInBay: 0,
              unreadBy: ['FOREMAN', 'OWNER'],
              logs: initialLogs,
              aiChat: [],
              mileage: data.mileage ?? 0
            };

            setRos(prev => [...prev, newRO]);
            setShowNewRODialog(false);

            if (supabase) {
              createROInFlightRef.current = true;
              createRepairOrder(newRO)
                .then(() => refetchRosAndBays())
                .catch((e) => console.error('createRepairOrder:', e))
                .finally(() => { createROInFlightRef.current = false; });
            }
          }} /> )}

      {showPaymentDialog && ( <PaymentDialog roId={showPaymentDialog} onClose={() => setShowPaymentDialog(null)} onSettle={(method: any, amount: any) => { 
            addLog(showPaymentDialog, `Payment Processed: ${method} ($${amount})`, 'SYSTEM');
            updateRO(showPaymentDialog, { 
              status: ROStatus.ARCHIVED, 
              paymentMethod: method, 
              paymentAmount: amount, 
              settledAt: new Date().toISOString() 
            }); 
            setShowPaymentDialog(null); 
            setSelectedROId(null); 
          }} /> )}
    </div>
  );
}

function getStatusLabels(workType: WorkType) {
  if (workType === 'BODY') {
    return {
      ...RO_STATUS_LABELS,
      [ROStatus.BODY_WORK]: 'Bodywork',
      [ROStatus.MECHANIC_WORK]: 'Mechanic To-do'
    };
  }
  return RO_STATUS_LABELS;
}

function KanbanCard({ ro, userRole, onClick, inInsuranceSection, userWorkType }: { ro: RepairOrder, userRole: Role, onClick: () => void, inInsuranceSection?: boolean, userWorkType: WorkType }) {
  const isUnread = ro.unreadBy.includes(userRole);
  const currentLines = ro.info.split('\n').filter(p => p.trim());
  const lastReadLines = (ro.lastReadInfo[userRole] || '').split('\n').filter(p => p.trim());

  const getStatusBorderColor = (s: ROStatus) => {
    switch(s) {
      case ROStatus.DONE: return 'bg-emerald-600';
      case ROStatus.IN_PROGRESS: return 'bg-blue-600';
      case ROStatus.PENDING: return 'bg-amber-600';
      case ROStatus.INSURANCE: return 'bg-[#6B4C7A]';
      case ROStatus.BODY_WORK: return 'bg-[#6B4C7A]';
      case ROStatus.PAINTING: return 'bg-yellow-500';
      case ROStatus.FINISHING_UP: return 'bg-purple-600';
      case ROStatus.MECHANIC_WORK: return 'bg-indigo-600';
      case ROStatus.ORDER_LIST: return 'bg-teal-600';
      case ROStatus.TODO: return 'bg-slate-400';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div 
      draggable 
      onDragStart={(e) => { e.dataTransfer.setData('roId', ro.id); e.stopPropagation(); }} 
      onClick={onClick} 
      className={`relative md:aspect-square w-full flex flex-col p-4 cursor-pointer transition-all duration-200 group border bg-white border-[#E5E7EB] hover:border-slate-400 shadow-sm min-h-[90px] md:min-h-[100px] ${ro.calendarEventId ? 'border-purple-200 bg-purple-50/10' : ''}`}
    >
      {isUnread && ( <div className="absolute top-3 right-3 w-2 h-2 bg-blue-600 rounded-full" /> )}
      
      {/* Top status line behavior */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${ro.urgent && userWorkType === 'MECHANIC' ? 'bg-red-600' : getStatusBorderColor(ro.status)}`} />

      <div className="flex justify-between items-start mb-2 md:mb-3 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h4 className={`text-[12px] md:text-[13px] font-black leading-tight truncate tracking-tight ${ro.urgent && userWorkType === 'MECHANIC' ? 'text-red-700' : 'text-slate-900'}`}>{ro.model}</h4>
        </div>
        <div className="flex items-center gap-1">
          {ro.isInsuranceCase && (
            <Shield size={12} className="text-[#6B4C7A] shrink-0" />
          )}
          {ro.calendarEventId && (
            <CalendarIcon size={12} className="text-purple-500 shrink-0" />
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 md:space-y-1.5 overflow-hidden pr-1">
        {currentLines.map((p, i) => {
          const isLineUnread = !lastReadLines.includes(p);
          return (
            <div key={i} className={`flex gap-2 p-1 rounded transition-colors ${isLineUnread ? 'bg-amber-50 border border-amber-100' : ''}`}>
              <div className={`w-1 h-1 rounded-full shrink-0 mt-2 ${isLineUnread ? 'bg-amber-600' : 'bg-slate-900'}`} />
              <p className={`text-[10px] md:text-[11px] font-bold leading-tight ${isLineUnread ? 'text-amber-900' : 'text-slate-900'}`}>{p}</p>
            </div>
          );
        })}
      </div>
      
      <div className="mt-1 md:mt-2 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {ro.calendarEventId && (
            <span className="text-[7px] font-black text-purple-700 uppercase tracking-widest bg-purple-100 px-1.5 py-0.5 rounded w-fit">CAL-SYNC</span>
          )}
          {userWorkType === 'BODY' && ro.deliveryDate && (
            <div className="flex items-center gap-1 text-[8px] font-black text-blue-700 uppercase tracking-tight bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 w-fit">
              <Clock size={10} /> {ro.deliveryDate}
            </div>
          )}
        </div>
        {ro.urgent && (
          <span className="text-[8px] font-black text-white uppercase tracking-[0.2em] px-1.5 py-0.5 rounded bg-red-600">URGENT</span>
        )}
      </div>
    </div>
  );
}

// CALENDAR VIEW COMPONENT
function CalendarView({ events, onAddEvent, onUpdateEvent, onDeleteEvent }: { events: CalendarEvent[], onAddEvent: (e: CalendarEvent) => void, onUpdateEvent: (e: CalendarEvent) => void, onDeleteEvent: (id: string) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'DAY' | 'WEEK' | 'MONTH'>('MONTH');
  const [showEventModal, setShowEventModal] = useState<Partial<CalendarEvent> | null>(null);

  const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  const startDay = startOfMonth.getDay();

  const days = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const day = i - startDay + 1;
      if (day <= 0 || day > daysInMonth) return null;
      return new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    });
  }, [currentDate, startDay, daysInMonth]);

  const next = () => {
    if (viewType === 'MONTH') setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    else if (viewType === 'WEEK') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    }
  };

  const prev = () => {
    if (viewType === 'MONTH') setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    else if (viewType === 'WEEK') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    }
  };

  const getEventsForDay = (date: Date) => {
    return events.filter(e => new Date(e.start).toDateString() === date.toDateString());
  };

  const renderView = () => {
    if (viewType === 'MONTH') {
      return (
        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
              <div key={d} className="p-4 text-[10px] font-black text-slate-400 text-center uppercase tracking-[0.2em]">{d}</div>
            ))}
          </div>
          <div className="flex-1 grid grid-cols-7">
            {days.map((date, i) => (
              <div 
                key={i} 
                className={`border-b border-r border-slate-100 p-2 min-h-[120px] md:min-h-[140px] flex flex-col gap-1 transition-all hover:bg-slate-50/50 cursor-pointer group ${!date ? 'bg-slate-50/20' : ''}`}
                onClick={() => date && setShowEventModal({ start: date.toISOString(), end: date.toISOString() })}
              >
                {date && (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[12px] font-black ${date.toDateString() === new Date().toDateString() ? 'bg-blue-600 text-white w-6 h-6 flex items-center justify-center rounded-full' : 'text-slate-500'}`}>
                        {date.getDate()}
                      </span>
                      <Plus size={12} className="text-slate-200 group-hover:text-blue-400 transition-colors" />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                      {getEventsForDay(date).map(event => (
                        <div 
                          key={event.id}
                          onClick={(e) => { e.stopPropagation(); setShowEventModal(event); }}
                          className="p-1.5 bg-blue-50 border border-blue-100 rounded-sm text-[9px] font-black text-blue-700 uppercase tracking-tight truncate cursor-pointer hover:bg-blue-100 hover:border-blue-300 transition-all flex items-center gap-1.5"
                        >
                          <div className="w-1 h-1 bg-blue-600 rounded-full shrink-0" /> {event.title}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    } else if (viewType === 'WEEK') {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        return d;
      });

      return (
        <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-8 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="p-4 border-r border-slate-200" />
            {weekDays.map(d => (
              <div key={d.toISOString()} className={`p-4 text-center border-r border-slate-200 ${d.toDateString() === new Date().toDateString() ? 'bg-blue-50/50' : ''}`}>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{d.toLocaleString('default', { weekday: 'short' })}</p>
                <p className={`text-xl font-black ${d.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-slate-900'}`}>{d.getDate()}</p>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-8 relative min-h-[1200px]">
              <div className="border-r border-slate-200 bg-slate-50/30">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="h-[50px] border-b border-slate-100 p-2 text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}</span>
                  </div>
                ))}
              </div>
              {weekDays.map(d => (
                <div key={d.toISOString()} className="relative border-r border-slate-200 group hover:bg-slate-50/20" onClick={() => setShowEventModal({ start: d.toISOString() })}>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="h-[50px] border-b border-slate-100" />
                  ))}
                  {getEventsForDay(d).map(event => (
                    <div 
                      key={event.id}
                      onClick={(e) => { e.stopPropagation(); setShowEventModal(event); }}
                      className="absolute inset-x-1 top-2 p-2 bg-blue-50 border-l-4 border-blue-600 shadow-sm rounded-sm text-[10px] font-black text-blue-700 uppercase cursor-pointer hover:bg-blue-100 transition-all z-10"
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-200 bg-slate-50 shrink-0 text-center">
             <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{currentDate.toLocaleString('default', { weekday: 'long' })}</p>
             <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">{currentDate.toLocaleString('default', { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-[100px_1fr] relative min-h-[1200px]">
              <div className="border-r border-slate-200 bg-slate-50/30">
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="h-[50px] border-b border-slate-100 p-2 text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase">{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}</span>
                  </div>
                ))}
              </div>
              <div className="relative group" onClick={() => setShowEventModal({ start: currentDate.toISOString() })}>
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="h-[50px] border-b border-slate-100" />
                ))}
                <div className="p-4 space-y-2">
                   {getEventsForDay(currentDate).map(event => (
                      <div 
                        key={event.id}
                        onClick={(e) => { e.stopPropagation(); setShowEventModal(event); }}
                        className="w-full p-4 bg-blue-50 border-l-8 border-blue-600 shadow-md rounded-md text-[11px] font-black text-blue-900 uppercase tracking-wide cursor-pointer hover:bg-blue-100 transition-all flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                           <Clock3 size={18} className="text-blue-500" />
                           <div>
                             <p>{event.title}</p>
                             <p className="text-[9px] text-blue-400 mt-1 font-bold">{event.description.split('\n')[0] || 'No additional details'}</p>
                           </div>
                        </div>
                        <ChevronRight size={18} className="text-blue-200" />
                      </div>
                   ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#F5F7FA] overflow-hidden p-4 md:p-8">
      <div className="max-w-[1400px] mx-auto w-full h-full flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-6 rounded-xl border border-slate-200 shadow-sm gap-4">
          <div className="flex items-center gap-6">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter whitespace-nowrap">
              {viewType === 'MONTH' ? currentDate.toLocaleString('default', { month: 'long', year: 'numeric' }) : viewType === 'WEEK' ? `Week of ${currentDate.toLocaleString('default', { month: 'short', day: 'numeric' })}` : currentDate.toLocaleString('default', { month: 'short', day: 'numeric' })}
            </h2>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button onClick={prev} className="p-2 hover:bg-white hover:shadow-sm rounded-md text-slate-400 hover:text-slate-900 transition-all"><ChevronLeft size={18} /></button>
              <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-500 hover:text-slate-900 tracking-widest">Today</button>
              <button onClick={next} className="p-2 hover:bg-white hover:shadow-sm rounded-md text-slate-400 hover:text-slate-900 transition-all"><ChevronRight size={18} /></button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {['DAY', 'WEEK', 'MONTH'].map(v => (
              <button 
                key={v}
                onClick={() => setViewType(v as any)}
                className={`px-5 py-2 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${viewType === v ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowEventModal({ start: new Date().toISOString(), end: new Date().toISOString() })}
              className="bg-slate-900 text-white px-6 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all flex items-center gap-2 border-b-4 border-slate-700 active:border-b-0"
            >
              <Plus size={16} /> New Event
            </button>
          </div>
        </div>

        {renderView()}
      </div>

      {showEventModal && (
        <CalendarEventModal 
          event={showEventModal} 
          onClose={() => setShowEventModal(null)}
          onSave={(e) => {
            if (e.id) onUpdateEvent(e);
            else onAddEvent({ ...e, id: Math.random().toString(36).substr(2, 9) });
            setShowEventModal(null);
          }}
          onDelete={(id) => {
            onDeleteEvent(id);
            setShowEventModal(null);
          }}
        />
      )}
    </div>
  );
}

function CalendarEventModal({ event, onClose, onSave, onDelete }: { event: Partial<CalendarEvent>, onClose: () => void, onSave: (e: CalendarEvent) => void, onDelete: (id: string) => void }) {
  const getInitialDateString = () => {
    if (event.start) return event.start.split('T')[0];
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  const [formData, setFormData] = useState({
    title: event.title || '',
    description: event.description || '',
    start: getInitialDateString(),
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className="bg-white border border-slate-200 w-full max-md rounded-none overflow-hidden shadow-2xl animate-in zoom-in duration-300">
        <div className="p-10">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter border-l-8 border-slate-900 pl-6">
              {event.id ? 'EVENT DETAILS' : 'NEW SCHEDULE'}
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X size={24} /></button>
          </div>
          <div className="space-y-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">VEHICLE PROFILE (TITLE)</label>
              <input 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 uppercase tracking-wider shadow-inner" 
                value={formData.title} 
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                placeholder="YEAR MAKE MODEL - CLIENT"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">WORK SCOPE (DESCRIPTION)</label>
              <textarea 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 uppercase tracking-wider min-h-[120px] resize-none shadow-inner" 
                value={formData.description} 
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="LIST REPAIRS TO PERFORM..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">EXECUTION DATE</label>
              <input 
                type="date"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 shadow-inner" 
                value={formData.start} 
                onChange={(e) => setFormData({...formData, start: e.target.value})}
              />
              <p className="text-[8px] font-bold text-blue-500 uppercase tracking-widest mt-2 flex items-center gap-1">
                <Zap size={10} /> Auto-Syncs to Body Work on this date
              </p>
            </div>
          </div>

          <div className="flex gap-4 mt-12">
            {event.id && (
              <button 
                onClick={() => onDelete(event.id!)}
                className="p-4 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all border border-red-100"
              >
                <Trash2 size={24} />
              </button>
            )}
            <button 
              onClick={() => {
                if (!formData.title) return;
                const [year, month, day] = formData.start.split('-').map(Number);
                const localDateObj = new Date(year, month - 1, day, 12, 0, 0);
                
                onSave({ 
                  id: event.id || '', 
                  title: formData.title, 
                  description: formData.description, 
                  start: localDateObj.toISOString(), 
                  end: localDateObj.toISOString() 
                })
              }} 
              className="flex-1 bg-slate-900 text-white py-5 rounded-lg font-black uppercase text-xs tracking-widest shadow-xl border-b-4 border-slate-700 active:border-b-0 hover:bg-slate-800 transition-all"
            >
              Commit to Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilePreviewModal({ attachment, onClose }: { attachment: Attachment, onClose: () => void }) {
  const isPdf = attachment.type === 'application/pdf';
  const isImage = attachment.type.startsWith('image/');

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 w-full max-w-6xl h-[90vh] rounded-xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-50 rounded text-blue-600">
              {isPdf ? <FileText size={20} /> : <ImageIcon size={20} />}
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{attachment.name}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase">{attachment.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {attachment.data && (
              <a 
                href={attachment.data} 
                download={attachment.name}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                <Download size={14} /> Save File
              </a>
            )}
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-all"
            >
              <X size={24} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 overflow-hidden relative flex items-center justify-center">
          {isPdf ? (
            <embed 
              src={attachment.data} 
              type="application/pdf" 
              className="w-full h-full"
            />
          ) : isImage ? (
            <img 
              src={attachment.data} 
              alt={attachment.name} 
              className="max-w-full max-h-full object-contain p-8 drop-shadow-2xl"
            />
          ) : (
            <div className="text-center p-12">
              <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
              <p className="text-sm font-black text-slate-900 uppercase tracking-widest">Preview Unavailable</p>
              <p className="text-xs text-slate-500 mt-2">Please download the file to view its content.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailModalWrapper(props: any) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [localModel, setLocalModel] = useState(props.ro.model);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [showInfoMobile, setShowInfoMobile] = useState(false);
  const [showVinDecode, setShowVinDecode] = useState(false);
  const modelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => { 
        if (props.preventClose || previewAttachment || showVinDecode) return; 
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) props.onClose(); 
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [props, previewAttachment, showVinDecode]);

  const handleToggleModelEdit = () => {
    if (isEditingModel) {
      props.onUpdate({ model: localModel });
      setIsEditingModel(false);
    } else {
      setIsEditingModel(true);
      setTimeout(() => modelInputRef.current?.focus(), 10);
    }
  };

  const asideContent = (
    <aside className={`w-full md:w-96 bg-[#F8FAFC] border-r border-slate-200 p-6 md:p-8 flex flex-col shrink-0 overflow-y-auto md:overflow-visible transition-all duration-300 ${!showInfoMobile ? 'hidden md:flex' : 'flex h-full'}`}>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black text-slate-500 tracking-[0.3em] uppercase">VEHICLE PROFILE</span>
          <div className="flex items-center gap-2">
            <button 
                onClick={handleToggleModelEdit} 
                className={`flex items-center justify-center p-2 rounded transition-all ${isEditingModel ? 'bg-slate-900 text-white' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}`}
            >
                {isEditingModel ? <Check size={12} /> : <Pencil size={12} />}
            </button>
            <button 
              onClick={() => setShowInfoMobile(false)} 
              className="md:hidden p-2 text-slate-400 hover:text-slate-900"
            >
              <MessageSquare size={18} />
            </button>
          </div>
        </div>
        {isEditingModel ? (
          <input 
              ref={modelInputRef}
              className="text-2xl font-black text-slate-900 leading-tight mt-2 bg-white border border-slate-300 rounded w-full px-4 py-2 outline-none" 
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleToggleModelEdit()}
          />
        ) : (
          <h2 className={`text-xl md:text-2xl font-black leading-tight mt-2 tracking-tighter ${props.ro.urgent ? 'text-red-700' : 'text-slate-900'}`}>{props.ro.model}</h2>
        )}
      </div>

      <div className="flex flex-col gap-3 mb-8">
        <div className="p-1 bg-white border border-slate-200 rounded shadow-sm">
          <span className="text-[9px] font-black text-slate-400 tracking-[0.3em] uppercase block mb-1.5 px-3 pt-2">WORKFLOW STATUS</span>
          <select 
            value={props.ro.status} 
            onChange={(e) => props.onUpdate({ status: e.target.value as ROStatus })}
            className={`w-full bg-white p-3 text-[11px] font-black outline-none uppercase tracking-widest transition-all cursor-pointer hover:bg-slate-50 ${props.getHeaderColor(props.ro.status)}`}
          >
            {Object.entries(getStatusLabels(props.workType))
              .filter(([val]) => {
                const s = val as ROStatus;
                if (s === ROStatus.ARCHIVED) return false;
                if (props.workType === 'MECHANIC') {
                  return [ROStatus.DONE, ROStatus.TODO, ROStatus.PENDING, ROStatus.IN_PROGRESS, ROStatus.BODY_WORK].includes(s);
                } else {
                  return [ROStatus.DONE, ROStatus.TODO, ROStatus.BODY_WORK, ROStatus.PAINTING, ROStatus.FINISHING_UP, ROStatus.MECHANIC_WORK].includes(s);
                }
              })
              .map(([val, label]) => (
              <option key={val} value={val} className={props.getHeaderColor(val as ROStatus)}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => props.onUpdate({ urgent: !props.ro.urgent })}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded border font-black text-[10px] uppercase tracking-[0.3em] transition-all ${
              props.ro.urgent 
                ? 'bg-red-600 text-white border-red-700 shadow-sm' 
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {props.ro.urgent ? 'URGENT' : 'MARK URGENT'}
          </button>
          <button 
            onClick={() => props.onUpdate({ isInsuranceCase: !props.ro.isInsuranceCase })}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded border font-black text-[10px] uppercase tracking-[0.3em] transition-all ${
              props.ro.isInsuranceCase 
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm' 
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {props.ro.isInsuranceCase ? 'INSURANCE' : 'NO INSURANCE'}
          </button>
        </div>
      </div>

      <div className="space-y-6 flex-1 md:overflow-y-auto custom-scrollbar pr-2 pb-6">
        <section className="min-h-[160px]">
          <BulletPointInput 
            value={props.ro.info} 
            lastReadValue={props.ro.lastReadInfo[props.userRole] || ''}
            onChange={(val: string) => props.onUpdate({ info: val })} 
            isInsurance={props.ro.isInsuranceCase}
            isCalendar={!!props.ro.calendarEventId}
            labelOverride="ORDER"
          />
        </section>
        
        {props.ro.status === ROStatus.DONE && (
          <div className="bg-emerald-50 p-5 rounded border border-emerald-200 shadow-sm mt-4">
             <div className="flex items-center gap-2 mb-2">
                <Timer size={14} className="text-emerald-700" />
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">BILLABLE BAY TIME</p>
             </div>
             <p className="text-xl font-black text-emerald-900 font-mono">
               {props.ro.totalTimeInBay > 0 ? formatMs(props.ro.totalTimeInBay) : '00:00:00'}
             </p>
          </div>
        )}

        <section className="space-y-3 pt-6 border-t border-slate-200">
          <CustomerInfoEdit 
            name={props.ro.customerName} 
            phone={props.ro.phone} 
            onChange={(name: string, phone: string) => props.onUpdate({ customerName: name, phone })} 
          />
          <DetailInfoEdit label="ORDER TOKEN" value={props.ro.id} onChange={(v: string) => props.onUpdate({ id: v })} />
          <DetailInfoEdit label="VIN IDENTIFIER" value={props.ro.vin} onChange={(v: string) => props.onUpdate({ vin: v })} isVin onScan={props.onScan} />
          
          {/* Mileage and VIN Specs for Mobile */}
          <div className="md:hidden space-y-3 pt-3">
            <div className="bg-white p-4 rounded border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">ODOMETER</p>
              <div className="flex items-center gap-3">
                <Navigation size={14} className="text-slate-400" />
                <span className="text-sm font-black font-mono text-slate-900">
                  {props.ro.mileage?.toLocaleString() || '0'} <span className="text-[10px] text-slate-400 ml-1 uppercase">KM</span>
                </span>
              </div>
            </div>

            {props.ro.decodedData && (
              <div className="bg-blue-50/50 p-4 rounded border border-blue-100">
                <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-3">VEHICLE SPECS</p>
                <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                  {[
                    { label: 'YEAR', value: props.ro.decodedData.year },
                    { label: 'MAKE', value: props.ro.decodedData.make },
                    { label: 'MODEL', value: props.ro.decodedData.model },
                    { label: 'ENGINE', value: props.ro.decodedData.engine },
                    { label: 'TRIM', value: props.ro.decodedData.trim },
                    { label: 'DRIVETRAIN', value: props.ro.decodedData.drivetrain },
                  ].filter(s => s.value).map((spec, i) => (
                    <div key={i}>
                      <p className="text-[8px] font-black text-blue-300 uppercase tracking-tighter">{spec.label}</p>
                      <p className="text-[10px] font-black text-blue-900 truncate">{spec.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {props.workType === 'BODY' && (
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 tracking-[0.3em] uppercase">DELIVERY DATE</label>
              <input 
                type="date" 
                value={props.ro.deliveryDate || ''} 
                onChange={(e) => props.onUpdate({ deliveryDate: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded p-3 text-[11px] font-black text-slate-900 outline-none focus:border-blue-600"
              />
            </div>
          )}
        </section>

        <section className="pt-6 border-t border-slate-200">
          <AttachmentSection 
            attachments={props.ro.attachments || []} 
            onUpdate={(newAttachments) => props.onUpdate({ attachments: newAttachments })}
            onPreview={(a) => setPreviewAttachment(a)}
          />
        </section>
        
        {props.ro.status === ROStatus.DONE && (props.userRole === 'ADVISOR' || props.userRole === 'OWNER') && (
          <div className="space-y-3 mt-8">
            <button 
              onClick={props.onShowPayment} 
              className="w-full py-5 bg-emerald-600 text-white rounded font-black uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-3 border-b-4 border-emerald-800 active:border-b-0 hover:bg-emerald-700 transition-all"
            >
              <DollarSign size={18} /> FINALIZE & COLLECT
            </button>
            <button 
              onClick={props.onNoRepair} 
              className="w-full py-3 bg-slate-100 text-red-600 rounded border border-slate-200 font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-50 transition-all"
            >
              <Ban size={14} /> VOID / NO REPAIR
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 md:p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div ref={modalRef} className="bg-white border-0 md:border md:border-slate-200 w-full max-w-7xl h-full md:h-[92vh] rounded-none md:rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row animate-in slide-in-from-bottom-4 duration-400">
        
        {!showInfoMobile && (
          <div className="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <button onClick={props.onClose} className="p-2 text-slate-400 hover:text-slate-900">
                <ArrowLeft size={20} />
              </button>
              <h3 className="text-sm font-black text-slate-900 truncate max-w-[120px] uppercase tracking-tighter">
                {props.ro.model}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={props.onScan} 
                className="flex items-center justify-center p-2 rounded bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-all shadow-sm"
              >
                <Camera size={16} />
              </button>
              <button 
                onClick={() => setShowInfoMobile(true)} 
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-slate-500 rounded border border-slate-200 text-[9px] font-black uppercase tracking-widest"
              >
                <Info size={14} /> Profile
              </button>
            </div>
          </div>
        )}

        {asideContent}
        
        <main className={`flex-1 flex flex-col bg-white overflow-hidden ${showInfoMobile ? 'hidden md:flex' : 'flex'}`}>
          <ModalTabs 
            {...props} 
            onShowVinDecode={() => setShowVinDecode(true)}
          />
        </main>
      </div>

      {previewAttachment && (
        <FilePreviewModal 
          attachment={previewAttachment} 
          onClose={() => setPreviewAttachment(null)} 
        />
      )}

      {showVinDecode && (
        <VinDecodeOverlay 
          ro={props.ro} 
          onClose={() => setShowVinDecode(false)} 
          onUpdate={props.onUpdate}
        />
      )}
    </div>
  );
}

function VinDecodeOverlay({ ro, onClose, onUpdate }: { ro: RepairOrder, onClose: () => void, onUpdate: (updates: any) => void }) {
  const [isDecoding, setIsDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDecode = async () => {
    if (!ro.vin || ro.vin === 'CALENDAR_SYNC') {
      setError("Please provide a valid VIN first.");
      return;
    }

    setIsDecoding(true);
    setError(null);
    try {
      const decoded = await decodeVIN(ro.vin);
      if (decoded) {
        const decodedData = {
          ...decoded,
          decodedAt: new Date().toISOString()
        };
        
        // Update the RO with decoded data and potentially update the model name if it's generic
        const updates: any = { decodedData };
        if (decoded.year && decoded.make && decoded.model) {
          updates.model = `${decoded.year} ${decoded.make} ${decoded.model}`;
        }
        
        onUpdate(updates);
      } else {
        setError("Could not decode this VIN. Please verify it is correct.");
      }
    } catch (err) {
      setError("An error occurred during decoding.");
    } finally {
      setIsDecoding(false);
    }
  };

  // Automatically trigger decode if it hasn't been decoded yet and we have a VIN
  useEffect(() => {
    if (!ro.decodedData && ro.vin && ro.vin !== 'CALENDAR_SYNC' && !isDecoding && !error) {
      handleDecode();
    }
  }, [ro.vin]);

  const specs = useMemo(() => {
    if (ro.decodedData) {
      return [
        { label: 'YEAR', value: ro.decodedData.year },
        { label: 'MAKE', value: ro.decodedData.make },
        { label: 'MODEL', value: ro.decodedData.model },
        { label: 'ENGINE', value: ro.decodedData.engine },
        { label: 'TRIM', value: ro.decodedData.trim },
        { label: 'TRANSMISSION', value: ro.decodedData.transmission },
        { label: 'DRIVETRAIN', value: ro.decodedData.drivetrain },
        { label: 'BODY STYLE', value: ro.decodedData.bodyStyle },
        { label: 'PLANT', value: ro.decodedData.plant },
      ].filter(s => s.value);
    }
    return [];
  }, [ro.decodedData]);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 w-full max-w-xl rounded-none shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-8 border-b-8 border-blue-600">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 text-white rounded shadow-lg">
                <Cpu size={24} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">OMNISCIENT DECODE</h2>
            </div>
            <button onClick={onClose} className="p-2 text-slate-300 hover:text-slate-900 transition-colors">
              <X size={24} />
            </button>
          </div>
          
          <div className="bg-slate-50 p-4 rounded border border-slate-100 mb-8 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">RAW IDENTIFIER</p>
              <p className="text-lg font-black font-mono text-slate-900 tracking-wider">{ro.vin}</p>
            </div>
            <button 
              onClick={handleDecode}
              disabled={isDecoding}
              className={`p-2 rounded border transition-all ${isDecoding ? 'bg-slate-100 text-slate-400' : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'}`}
              title="Re-decode"
            >
              <RefreshCcw size={18} className={isDecoding ? 'animate-spin' : ''} />
            </button>
          </div>

          {isDecoding ? (
            <div className="py-20 flex flex-col items-center justify-center gap-4">
              <RefreshCcw size={48} className="text-blue-600 animate-spin" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">Analyzing VIN Structure...</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertTriangle size={48} className="text-amber-500 mx-auto mb-4" />
              <p className="text-sm font-black text-slate-900 uppercase tracking-tight mb-2">{error}</p>
              <button 
                onClick={handleDecode}
                className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline"
              >
                Try Again
              </button>
            </div>
          ) : specs.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {specs.map((spec, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0 group hover:bg-slate-50/50 px-2 transition-colors">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{spec.label}</span>
                  <span className="text-xs font-black text-slate-900 uppercase tracking-tight">{spec.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Info size={48} className="text-slate-200 mx-auto mb-4" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No data available. Click refresh to decode.</p>
            </div>
          )}

          <div className="mt-10 pt-6 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3 text-blue-600">
              <Zap size={14} />
              <p className="text-[10px] font-black uppercase tracking-[0.2em]">INTELLIGENT HARDWARE SYNC COMPLETE</p>
            </div>
            {ro.decodedData?.decodedAt && (
              <p className="text-[8px] font-bold text-slate-400 uppercase">
                Last Decoded: {new Date(ro.decodedData.decodedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentSection({ attachments, onUpdate, onPreview }: { attachments: Attachment[], onUpdate: (files: Attachment[]) => void, onPreview: (a: Attachment) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((f: File) => {
        const reader = new FileReader();
        const id = Math.random().toString(36).substr(2, 9);
        const name = f.name;
        const type = f.type;
        
        return new Promise<Attachment>((resolve) => {
          reader.onload = () => resolve({ id, name, type, data: reader.result as string });
          reader.readAsDataURL(f);
        });
      });

      Promise.all(newFiles).then(resolvedFiles => {
        onUpdate([...attachments, ...resolvedFiles]);
      });
    }
  };

  const removeAttachment = (id: string) => {
    onUpdate(attachments.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">ATTACHMENTS</p>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="p-2 bg-slate-100 text-slate-600 rounded border border-slate-200 hover:bg-slate-200 transition-all shadow-sm"
        >
          <UploadCloud size={14} />
          <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleUpload} />
        </button>
      </div>

      <div className="space-y-2">
        {attachments.length > 0 ? attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded group hover:border-blue-400 transition-all shadow-sm">
            <div 
              className="flex items-center gap-3 cursor-pointer flex-1"
              onClick={() => onPreview(a)}
            >
              <div className="p-2 bg-slate-50 rounded text-blue-600">
                <FileText size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black text-slate-700 truncate uppercase tracking-wide">{a.name}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{a.type.split('/')[1] || 'DOC'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => onPreview(a)}
                className="p-2 text-slate-400 hover:text-blue-600"
              >
                <Maximize2 size={14} />
              </button>
              <button 
                onClick={() => removeAttachment(a.id)}
                className="p-2 text-slate-400 hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )) : (
          <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg">
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">No documents attached</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerInfoEdit({ name, phone, onChange }: { name: string, phone: string, onChange: (n: string, p: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [localName, setLocalName] = useState(name);
  const [localPhone, setLocalPhone] = useState(phone);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (isEditing) {
      onChange(localName, localPhone);
      setIsEditing(false);
    } else {
      setIsEditing(true);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  return (
    <div className="bg-white p-4 rounded border border-slate-200 shadow-sm group hover:border-slate-300 transition-all">
      <div className="flex justify-between items-start mb-2">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CUSTOMER DATA</p>
        <button 
          onClick={handleToggle} 
          className={`flex items-center justify-center p-1.5 rounded transition-all ${isEditing ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}
        >
          {isEditing ? <Check size={14} /> : <Pencil size={14} />}
        </button>
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <input 
            ref={inputRef}
            className="text-[12px] font-black text-slate-900 bg-slate-50 border border-slate-200 rounded w-full px-2 py-1 focus:border-blue-600 outline-none"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
          />
          <input 
            className="text-[12px] font-black text-slate-900 bg-slate-50 border border-slate-200 rounded w-full px-2 py-1 focus:border-blue-600 outline-none"
            value={localPhone}
            onChange={(e) => setLocalPhone(e.target.value)}
          />
        </div>
      ) : (
        <div className="cursor-default">
          <p className="text-[12px] font-black text-slate-900">{name}</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">{phone}</p>
        </div>
      )}
    </div>
  );
}

function DetailInfoEdit({ label, value, onChange, isVin, onScan }: { label: string, value: string, onChange: (v: string) => void, isVin?: boolean, onScan?: () => void }) {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (!isEditing) setLocalValue(value); }, [value, isEditing]);

    const handleToggle = () => {
        if (isEditing) {
            onChange(localValue);
            setIsEditing(false);
        } else {
            setIsEditing(true);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    };

    return (
        <div className="bg-white p-4 rounded border border-slate-200 shadow-sm group hover:border-slate-300 transition-all">
            <div className="flex justify-between items-start mb-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={handleToggle} 
                        className={`flex items-center justify-center p-1.5 rounded transition-all ${isEditing ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {isEditing ? <Check size={14} /> : <Pencil size={14} />}
                    </button>
                </div>
            </div>
            <input 
                ref={inputRef}
                readOnly={!isEditing}
                className={`text-[12px] font-black text-slate-800 bg-transparent border-none w-full p-0 focus:ring-0 outline-none transition-opacity ${isVin ? 'font-mono' : ''} ${!isEditing ? 'opacity-90' : 'opacity-100 bg-slate-50 rounded px-1 border border-slate-200'}`}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
            />
        </div>
    );
}

function AutoResizingTextarea({ value, onChange, placeholder, className, readOnly, onKeyDown }: { value: string, onChange?: (val: string) => void, placeholder?: string, className?: string, readOnly?: boolean, onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };
  useEffect(() => { adjustHeight(); }, [value]);
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      readOnly={readOnly}
      rows={1}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}

const BulletPointInput = forwardRef(({ value, lastReadValue, onChange, defaultEditing = false, hideToggle = false, isInsurance = false, isCalendar = false, labelOverride }: { value: string, lastReadValue: string, onChange: (v: string) => void, defaultEditing?: boolean, hideToggle?: boolean, isInsurance?: boolean, isCalendar?: boolean, labelOverride?: string }, ref) => {
  const [items, setItems] = useState<string[]>(value.split('\n').filter(Boolean));
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [newItem, setNewItem] = useState('');
  const lastReadLines = useMemo(() => lastReadValue.split('\n').filter(Boolean), [lastReadValue]);

  useEffect(() => { if (!isEditing && !defaultEditing) setItems(value.split('\n').filter(Boolean)); }, [value, isEditing, defaultEditing]);

  const handleAdd = () => { 
    if (!newItem.trim()) return; 
    const updated = [...items, newItem.trim()];
    setItems(updated); 
    setNewItem(''); 
    if (defaultEditing) onChange(updated.join('\n'));
  };

  const handleToggle = () => {
    if (isEditing) {
      const finalItems = newItem.trim() ? [...items, newItem.trim()] : items;
      setItems(finalItems);
      setNewItem('');
      onChange(finalItems.join('\n'));
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  };

  useImperativeHandle(ref, () => ({
    getFinalValue: () => {
      const finalItems = newItem.trim() ? [...items, newItem.trim()] : items;
      return finalItems.join('\n');
    }
  }));

  const handleUpdateItem = (idx: number, newVal: string) => {
    const updated = [...items];
    updated[idx] = newVal;
    setItems(updated);
    if (defaultEditing) onChange(updated.join('\n'));
  };

  const handleRemove = (idx: number) => { 
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated); 
    if (defaultEditing) onChange(updated.join('\n'));
  };

  return (
    <div className={`space-y-4`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">{labelOverride || 'INFO'}</p>
           {isInsurance && <Shield size={14} className="text-[#6B4C7A]" />}
           {isCalendar && <CalendarIcon size={14} className="text-purple-500" />}
        </div>
        {!hideToggle && (
          <button 
            onClick={handleToggle}
            className={`flex items-center justify-center p-2 rounded transition-all ${isEditing ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'}`}
          >
            {isEditing ? <Check size={14} /> : <Pencil size={14} />}
          </button>
        )}
      </div>
      
      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
        {items.map((item, i) => {
          const isLineUnread = !lastReadLines.includes(item);
          return (
            <div key={i} className="flex items-start gap-2 group">
              {isEditing ? (
                <div className="flex-1">
                  <AutoResizingTextarea
                    className="w-full bg-slate-50 border border-slate-200 p-4 rounded text-[11px] font-black text-slate-900 outline-none focus:border-blue-600"
                    value={item}
                    onChange={(val) => handleUpdateItem(i, val)}
                  />
                </div>
              ) : (
                <div className={`flex-1 flex items-start gap-3 bg-white border p-4 rounded text-[11px] font-black text-slate-700 leading-relaxed transition-all shadow-sm ${isLineUnread ? 'border-amber-300 bg-amber-50 shadow-inner' : 'border-slate-100 opacity-80'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${isLineUnread ? 'bg-amber-600 shadow-sm' : 'bg-slate-900'}`} />
                  {item}
                </div>
              )}
              {isEditing && (
                <button onClick={() => handleRemove(i)} className="p-2 text-slate-400 hover:text-red-600 transition-all shrink-0 mt-3">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isEditing && (
        <div className="flex gap-2 mt-4 items-end">
          <AutoResizingTextarea 
            placeholder="ADD NEW INFO POINT..." 
            className="flex-1 bg-white border border-slate-200 rounded p-4 text-[10px] font-black text-slate-900 outline-none focus:border-blue-600 shadow-sm h-12" 
            value={newItem} 
            onChange={(val) => setNewItem(val)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <button onClick={handleAdd} className="bg-slate-900 text-white rounded hover:bg-slate-800 transition shadow-md h-12 w-12 flex items-center justify-center shrink-0 border-b-4 border-slate-700 active:border-b-0">
            <Plus size={24} />
          </button>
        </div>
      )}
    </div>
  );
});

function ModalTabs({ ro, userRole, onAddLog, onAddAiLog, onUpdate, onShowVinDecode }: any) {
  const [tab, setTab] = useState<'UPDATES' | 'AI'>('UPDATES');
  const [input, setInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isEditingMileage, setIsEditingMileage] = useState(false);
  const [localMileage, setLocalMileage] = useState(ro.mileage?.toString() || '0');
  const mileageInputRef = useRef<HTMLInputElement>(null);

  const currentLogs = tab === 'AI' ? (ro.aiChat || []) : ro.logs;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [currentLogs, tab]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    if (tab === 'UPDATES') {
      onAddLog(text, 'USER');
    } else { 
      setIsAiLoading(true); 
      onAddAiLog(text, 'USER'); 
      
      const context: DiagnosticContext = {
        vehicleProfile: {
          model: ro.model,
          vin: ro.vin,
          info: ro.info,
          isInsurance: !!ro.isInsuranceCase
        },
        eventLog: ro.logs.map((l: LogEntry) => ({
          user: l.user,
          text: l.text,
          timestamp: l.timestamp,
          imageUrl: l.imageUrl
        })),
        attachments: (ro.attachments || []).map((a: Attachment) => ({
          name: a.name,
          data: a.data,
          type: a.type
        })),
        userMessage: text
      };

      const advice = await getDiagnosticAdvice(context); 
      onAddAiLog(advice || "Omniscient analysis complete.", 'AI'); 
      setIsAiLoading(false); 
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { 
        if (tab === 'UPDATES') {
          onAddLog(`Attached Photo: ${file.name}`, 'USER', reader.result as string); 
        } else {
          onAddAiLog(`Attached Photo: ${file.name}`, 'USER', reader.result as string); 
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMileageUpdate = () => {
    const newVal = parseInt(localMileage);
    if (!isNaN(newVal)) {
      onUpdate({ mileage: newVal });
    }
    setIsEditingMileage(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Merged Header */}
      <div className="flex items-center justify-between px-0 md:px-8 border-b border-slate-200 h-14 md:h-16 shrink-0 bg-white shadow-sm">
        <div className="flex-1 md:flex-none flex h-full">
          <button 
            onClick={() => setTab('UPDATES')} 
            className={`flex-1 md:flex-none h-full border-b-2 font-black text-[9px] md:text-[10px] tracking-widest uppercase px-4 md:px-8 transition-all flex items-center justify-center ${tab === 'UPDATES' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            EVENT LOG
          </button>
          <button 
            onClick={() => setTab('AI')} 
            className={`flex-1 md:flex-none h-full border-b-2 font-black text-[9px] md:text-[10px] tracking-widest uppercase px-4 md:px-8 flex items-center justify-center gap-2 md:gap-3 transition-all ${tab === 'AI' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            <Activity size={14} /> DIAGNOSTIC AI
          </button>
        </div>
        
        <div className="hidden md:flex items-center gap-4">
          <div 
            className="flex items-center gap-3 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg group hover:border-blue-400 transition-all cursor-default"
            onDoubleClick={() => {
              setLocalMileage(ro.mileage?.toString() || '0');
              setIsEditingMileage(true);
              setTimeout(() => mileageInputRef.current?.focus(), 10);
            }}
          >
            <Navigation size={14} className="text-slate-400 group-hover:text-blue-500" />
            {isEditingMileage ? (
              <input 
                ref={mileageInputRef}
                className="w-20 bg-white border-none p-0 text-xs font-black font-mono focus:ring-0 outline-none"
                value={localMileage}
                onChange={(e) => setLocalMileage(e.target.value)}
                onBlur={handleMileageUpdate}
                onKeyDown={(e) => e.key === 'Enter' && handleMileageUpdate()}
              />
            ) : (
              <span className="text-xs font-black font-mono text-slate-700 select-none">
                {ro.mileage?.toLocaleString() || '0'} <span className="text-[10px] text-slate-400 ml-1">KM</span>
              </span>
            )}
          </div>
          
          <button 
            onClick={onShowVinDecode}
            className="p-2.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
          >
            <Car size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 bg-white space-y-6 custom-scrollbar">
        {currentLogs.map((log: LogEntry) => (
          <div key={log.id} className={`flex ${log.type === 'SYSTEM' ? 'justify-center' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            {log.type === 'SYSTEM' ? ( 
              <div className="text-[8px] md:text-[9px] font-black text-slate-400 bg-slate-50 px-4 py-1 rounded uppercase tracking-wider border border-slate-100">{log.text} • {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div> 
            ) : (
              <div className={`max-w-[95%] md:max-w-[90%] rounded-lg p-4 md:p-6 border ${log.type === 'AI' ? 'bg-blue-50 border-blue-100 text-blue-900 shadow-sm' : 'bg-[#F8FAFC] border-slate-100 text-slate-900 shadow-sm'}`}>
                <div className="flex items-center justify-between gap-6 md:gap-10 mb-3 md:mb-4">
                  <span className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest ${log.type === 'AI' ? 'text-blue-700' : 'text-slate-400'}`}>{log.type === 'AI' ? 'CORE INTELLIGENCE' : log.user}</span>
                  <span className="text-[8px] md:text-[9px] font-bold text-slate-400">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {log.imageUrl && <img src={log.imageUrl} className="w-full h-auto rounded border border-slate-200 mb-4" alt="Update" />}
                <div className="text-xs md:text-sm font-bold whitespace-pre-wrap leading-relaxed tracking-tight prose prose-slate max-w-none">{log.text}</div>
              </div>
            )}
          </div>
        ))}
        {isAiLoading && ( 
          <div className="flex justify-start"> 
            <div className="bg-blue-50 text-blue-700 rounded-lg p-4 md:p-6 border border-blue-100 flex items-center gap-4"> 
              <div className="flex gap-1.5"> 
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" /> 
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '150ms'}} /> 
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '300ms'}} /> 
              </div> 
              <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em]">INTEGRATING LOGS + SPECS + IMAGES</span> 
            </div> 
          </div> 
        )}
      </div>
      <div className="p-4 md:p-6 bg-slate-50 border-t border-slate-200 flex items-center gap-3 md:gap-4 shrink-0">
        <div className="shrink-0">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-500 hover:text-slate-900 transition-all bg-white border border-slate-200 rounded hover:border-slate-400 shadow-sm">
            <ImageIcon size={20} />
          </button>
        </div>
        <div className="flex-1 flex items-center">
          <textarea 
            placeholder={tab === 'AI' ? "ASK AI..." : "LOG UPDATE..."} 
            className="w-full bg-white border border-slate-200 rounded px-3 md:px-4 py-3.5 md:py-5 outline-none focus:border-blue-600 text-[11px] font-black text-slate-900 tracking-wide h-12 md:h-16 custom-scrollbar resize-none shadow-inner leading-tight" 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} 
          />
        </div>
        <button onClick={handleSend} className="bg-slate-900 text-white p-3 md:p-4 rounded shadow-md border-b-4 border-slate-700 active:border-b-0 hover:bg-slate-800">
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
}

function VINScanner({ onClose, onScan }: { onClose: () => void, onScan: (vin: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => { 
    async function startCamera() { try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); setStream(s); if (videoRef.current) videoRef.current.srcObject = s; } catch (e) { alert("Camera access required."); onClose(); } } 
    startCamera(); return () => stream?.getTracks().forEach(t => t.stop()); 
  }, []);
  return (
    <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-xl">
      <div className="relative w-full max-4xl aspect-video rounded border-4 border-slate-700 overflow-hidden bg-black shadow-2xl">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover opacity-90" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-0 w-full h-1 bg-blue-600 shadow-md animate-[scan_3s_infinite]" />
          <div className="absolute inset-10 border-2 border-dashed border-white/10" />
        </div>
      </div>
      <div className="mt-12 flex gap-6"> 
        <button onClick={onClose} className="px-12 py-4 bg-white text-slate-600 rounded font-black uppercase text-xs tracking-widest border border-slate-300 shadow-sm">ABORT</button> 
        <button onClick={() => onScan("WBS" + Math.random().toString(36).substr(2, 14).toUpperCase())} className="px-12 py-4 bg-blue-600 text-white rounded font-black uppercase text-xs tracking-widest shadow-xl border-b-4 border-blue-800 active:border-b-0">CAPTURE VIN</button> 
      </div>
    </div>
  );
}

function BayTimer({ ro }: { ro: RepairOrder }) {
  const [sessionElapsed, setSessionElapsed] = useState(0);
  useEffect(() => { 
    const update = () => setSessionElapsed(ro.lastEnteredBayAt ? Date.now() - ro.lastEnteredBayAt : 0);
    update(); const iv = setInterval(update, 1000); return () => clearInterval(iv); 
  }, [ro.lastEnteredBayAt]);
  return (
    <div className="flex-col font-mono flex">
      <span className="text-[11px] font-black text-blue-700">{formatMs(sessionElapsed)}</span>
      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter">TTL: {formatMs(ro.totalTimeInBay + sessionElapsed)}</span>
    </div>
  );
}

function NewRODialog({ onClose, onSubmit }: { onClose: () => void, onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState({ model: '', customerName: '', phone: '', info: '', urgent: false, isInsuranceCase: false, deliveryDate: '' });
  const [orderType, setOrderType] = useState<WorkType>('MECHANIC');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const infoRef = useRef<{ getFinalValue: () => string }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInitiate = () => {
    if (!formData.model || !formData.customerName) return;
    const finalInfo = infoRef.current?.getFinalValue() || formData.info;
    
    // Default status for all new orders is TODO
    const initialStatus = ROStatus.TODO;

    const attachmentsPromise = uploadedFiles.map(f => {
      const reader = new FileReader();
      return new Promise<Attachment>((resolve) => {
        reader.onload = () => resolve({ id: Math.random().toString(36).substr(2, 9), name: f.name, type: f.type, data: reader.result as string });
        reader.readAsDataURL(f);
      });
    });

    Promise.all(attachmentsPromise).then(attachments => {
      onSubmit({ 
        ...formData, 
        info: finalInfo, 
        vin: 'PENDING', 
        status: initialStatus, 
        workType: orderType,
        attachments: attachments.length > 0 ? attachments : undefined
      });
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white border border-slate-200 w-full max-xl rounded-xl md:rounded-none overflow-hidden shadow-2xl animate-in zoom-in duration-400">
        <div className="p-6 md:p-12">
          <div className="flex items-center justify-between mb-6 md:mb-8">
            <h3 className="text-xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter border-l-4 md:border-l-8 border-slate-900 pl-4 md:pl-6">NEW ORDER</h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setFormData({...formData, isInsuranceCase: !formData.isInsuranceCase})} 
                className={`flex items-center gap-2 px-4 py-1.5 md:px-6 md:py-2 rounded font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all ${formData.isInsuranceCase ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}
              >
                <Shield size={14} /> INSURANCE
              </button>
              <button onClick={() => setFormData({...formData, urgent: !formData.urgent})} className={`flex items-center gap-2 px-4 py-1.5 md:px-6 md:py-2 rounded font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all ${formData.urgent ? 'bg-red-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>URGENT</button>
            </div>
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 mb-6 md:mb-8">
            <button onClick={() => setOrderType('MECHANIC')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 md:py-3 rounded-md text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${orderType === 'MECHANIC' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}><Wrench size={14} /> Mechanic Order</button>
            <button onClick={() => setOrderType('BODY')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 md:py-3 rounded-md text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${orderType === 'BODY' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}><Car size={14} /> Body Order</button>
          </div>

          <div className="space-y-4 md:space-y-6 max-h-[60vh] md:max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
            <div className="space-y-2">
              <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">MODEL</label>
              <input className="w-full bg-slate-50 border border-slate-200 rounded p-3 md:p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 tracking-wider transition-all" value={formData.model} onChange={(e) => setFormData({...formData, model: e.target.value})}/>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">CLIENT</label>
                <input className="w-full bg-slate-50 border border-slate-200 rounded p-3 md:p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 tracking-wider transition-all" value={formData.customerName} onChange={(e) => setFormData({...formData, customerName: e.target.value})}/>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">PHONE</label>
                <input className="w-full bg-slate-50 border border-slate-200 rounded p-3 md:p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 tracking-wider transition-all" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})}/>
              </div>
            </div>
            
            <div className="space-y-2">
              <BulletPointInput ref={infoRef} value={formData.info} lastReadValue="" onChange={(val: string) => setFormData({...formData, info: val})} defaultEditing={true} hideToggle={true}/>
            </div>

            {orderType === 'BODY' && (
              <div className="space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">DELIVERY DATE</label>
                <input 
                  type="date" 
                  className="w-full bg-slate-50 border border-slate-200 rounded p-3 md:p-4 text-xs font-black text-slate-900 outline-none focus:border-blue-600 tracking-wider transition-all" 
                  value={formData.deliveryDate} 
                  onChange={(e) => setFormData({...formData, deliveryDate: e.target.value})}
                />
              </div>
            )}

            <div className="space-y-2 border-t border-slate-100 pt-6 mt-6">
              <label className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">ATTACHMENTS</label>
              <div onClick={() => fileInputRef.current?.click()} className="w-full border border-dashed border-slate-200 rounded-xl bg-slate-50 p-4 md:p-8 flex flex-col items-center justify-center gap-2 md:gap-4 cursor-pointer hover:border-blue-400 hover:bg-white transition-all group shadow-inner">
                <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                <div className="p-2 md:p-4 bg-white rounded-full text-slate-300 group-hover:text-blue-600 group-hover:scale-105 transition-all shadow-sm"><UploadCloud size={24} className="md:w-8 md:h-8" /></div>
                <div className="text-center"><p className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">Upload documents or images</p></div>
              </div>
              {uploadedFiles.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {uploadedFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1 rounded text-[8px] md:text-[9px] font-black text-blue-700 uppercase">
                      <FileText size={10} className="md:w-3 md:h-3" /> {file.name}
                      <button onClick={(e) => { e.stopPropagation(); setUploadedFiles(prev => prev.filter((_, idx) => idx !== i)); }} className="hover:text-red-600 transition-colors"><Trash2 size={10} className="md:w-3 md:h-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 mt-8 md:mt-12 pt-6 border-t border-slate-100">
            <button onClick={onClose} className="flex-1 py-3 md:py-4 bg-slate-100 text-slate-500 rounded font-black uppercase text-[10px] md:text-[11px] tracking-widest border border-slate-200 hover:bg-slate-200 transition-all">CANCEL</button>
            <button onClick={handleInitiate} className={`flex-[2] py-3 md:py-4 rounded font-black uppercase text-[10px] md:text-[11px] tracking-widest shadow-xl border-b-4 active:border-b-0 transition-all ${orderType === 'MECHANIC' ? 'bg-slate-900 border-slate-700 hover:bg-slate-800 text-white' : 'bg-[#6B4C7A] border-[#4A3256] hover:bg-[#583E65] text-white'}`}>{orderType === 'MECHANIC' ? 'INITIATE MECHANIC RO' : 'START BODY WORK'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllRepairOrdersView({ 
  ros, 
  onSelectRO, 
  currentSectionOrder, 
  workType, 
  userRole, 
  getStatusStyles, 
  getHeaderColor 
}: { 
  ros: RepairOrder[], 
  onSelectRO: (id: string) => void,
  currentSectionOrder: ROStatus[],
  workType: WorkType,
  userRole: Role,
  getStatusStyles: (s: ROStatus) => string,
  getHeaderColor: (s: ROStatus) => string
}) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ROStatus | null>(null);
  const labels = getStatusLabels(workType);
  
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return ros.filter(ro => ro.status !== ROStatus.ARCHIVED && (
      ro.model.toLowerCase().includes(q) ||
      ro.customerName.toLowerCase().includes(q) ||
      ro.vin.toLowerCase().includes(q) ||
      ro.id.toLowerCase().includes(q)
    )).filter(ro => !activeFilter || ro.status === activeFilter);
  }, [ros, search, activeFilter]);

  const grouped = useMemo(() => {
    const groups: Record<string, RepairOrder[]> = {};
    currentSectionOrder.forEach(status => {
      groups[status] = filtered.filter(ro => ro.status === status);
    });
    return groups;
  }, [filtered, currentSectionOrder, workType]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F5F7FA] w-full">
      <div className="px-6 md:px-10 py-6 md:py-8 bg-white border-b border-slate-200 shrink-0 shadow-sm">
        <div className="max-w-[1800px] mx-auto flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 md:gap-5">
              <div className="text-slate-900 p-2 md:p-3 bg-slate-100 rounded border border-slate-200">
                <LayoutGrid className="w-6 h-6 md:w-8 md:h-8" />
              </div>
              <div>
                <h2 className="text-xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">All Repair Orders</h2>
                <p className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{filtered.length} Active Units</p>
              </div>
            </div>
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="SEARCH ALL UNITS..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                className="pl-10 pr-4 py-2 md:py-3 rounded bg-slate-50 border border-slate-200 focus:border-blue-600 focus:ring-0 text-[10px] md:text-[11px] font-black text-slate-900 w-full md:w-[400px] uppercase tracking-widest shadow-inner" 
              />
            </div>
          </div>

          {/* Color Legend / Filter */}
          <div className="flex flex-wrap gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest self-center">Status Filter:</span>
              {activeFilter && (
                <button 
                  onClick={() => setActiveFilter(null)}
                  className="text-[8px] font-black text-blue-600 uppercase tracking-widest hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            {currentSectionOrder.map(status => {
              const isActive = activeFilter === status;
              return (
                <button 
                  key={status} 
                  onClick={() => setActiveFilter(isActive ? null : status)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all shadow-xs ${isActive ? 'bg-slate-900 border-slate-900 ring-2 ring-slate-900 ring-offset-2' : 'bg-white border-slate-200 hover:border-slate-400'}`}
                >
                  <div className={`w-3 h-3 rounded-sm ${getStatusStyles(status)} border`} />
                  <span className={`text-[9px] font-black uppercase tracking-tight ${isActive ? 'text-white' : getHeaderColor(status)}`}>{labels[status]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
        <div className="max-w-[1800px] mx-auto">
          {workType === 'BODY' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-4">
              {currentSectionOrder.flatMap(status => grouped[status] || []).map(ro => (
                <KanbanCard 
                  key={ro.id} 
                  ro={ro} 
                  userRole={userRole} 
                  userWorkType={workType} 
                  onClick={() => onSelectRO(ro.id)} 
                  inInsuranceSection={ro.status === ROStatus.BODY_WORK}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {currentSectionOrder.map(status => {
                const items = grouped[status] || [];
                if (items.length === 0 && search) return null; // Hide empty rows when searching
                
                return (
                  <section key={status} className="flex flex-col gap-4">
                    <div className="flex items-center gap-4 px-2">
                      <h3 className={`text-xs font-black uppercase tracking-[0.2em] ${getHeaderColor(status)}`}>{labels[status]}</h3>
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-[10px] font-black text-slate-400 uppercase">{items.length} Units</span>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-4">
                      {items.map(ro => (
                        <KanbanCard 
                          key={ro.id} 
                          ro={ro} 
                          userRole={userRole} 
                          userWorkType={workType} 
                          onClick={() => onSelectRO(ro.id)} 
                          inInsuranceSection={status === ROStatus.BODY_WORK}
                        />
                      ))}
                      {items.length === 0 && (
                        <div className="col-span-full py-8 border-2 border-dashed border-slate-100 rounded-xl flex items-center justify-center">
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No units in this status</p>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <LayoutGrid size={48} className="mb-4 opacity-20" />
              <p className="text-xs font-black uppercase tracking-widest">No matching records found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderHistoryView({ workType, ros, onRestore, onView }: any) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchHistory, setSearchHistory] = useState('');
  const [insuranceFilter, setInsuranceFilter] = useState<'ALL' | 'ONLY' | 'NONE'>('ALL');
  const [methods, setMethods] = useState<Set<string>>(new Set(['CASH', 'CHEQUE', 'ABANDONED']));
  
  const toggleMethod = (m: string) => {
    const next = new Set(methods);
    if (next.has(m)) next.delete(m); else next.add(m);
    setMethods(next);
  };

  const filtered = useMemo(() => {
    const q = searchHistory.toLowerCase().trim();
    const qRaw = q.replace(/\D/g, '');
    return ros.filter((ro: any) => {
      const matchMethod = methods.has(ro.paymentMethod || '');
      
      let matchInsurance = true;
      if (insuranceFilter === 'ONLY') matchInsurance = !!ro.isInsuranceCase;
      else if (insuranceFilter === 'NONE') matchInsurance = !ro.isInsuranceCase;
      
      let matchDate = true;
      if (ro.settledAt) {
        const d = ro.settledAt.split('T')[0];
        if (startDate && d < startDate) matchDate = false;
        if (endDate && d > endDate) matchDate = false;
      }
      let matchSearch = true;
      if (q) {
        const phoneRaw = ro.phone.replace(/\D/g, '');
        matchSearch = ((qRaw && phoneRaw.includes(qRaw)) || ro.customerName.toLowerCase().includes(q) || ro.model.toLowerCase().includes(q) || ro.id.toLowerCase().includes(q) || ro.vin.toLowerCase().includes(q));
      }
      return matchMethod && matchDate && matchSearch && matchInsurance;
    });
  }, [ros, methods, startDate, endDate, searchHistory, insuranceFilter]);

  const stats = useMemo(() => {
    let totalRev = 0, cashSum = 0, chequeSum = 0, noRepairCount = 0;
    filtered.forEach((ro: any) => {
      if (ro.paymentMethod === 'CASH') { cashSum += ro.paymentAmount || 0; totalRev += ro.paymentAmount || 0; }
      else if (ro.paymentMethod === 'CHEQUE') { chequeSum += ro.paymentAmount || 0; totalRev += ro.paymentAmount || 0; }
      else if (ro.paymentMethod === 'ABANDONED') { noRepairCount++; }
    });
    return { totalRev, cashSum, chequeSum, noRepairCount, count: filtered.length };
  }, [filtered]);

  return (
    <div className="h-full bg-[#F5F7FA] flex flex-col overflow-hidden w-full">
      <div className="px-6 md:px-10 py-6 md:py-8 bg-white border-b border-slate-200 shrink-0 shadow-sm">
        <div className="max-w-[1800px] mx-auto flex flex-col gap-6 md:gap-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3 md:gap-5">
                <div className="text-slate-900 p-2 md:p-3 bg-slate-100 rounded border border-slate-200"><History className="w-6 h-6 md:w-8 md:h-8" /></div>
                <h2 className="text-xl md:text-3xl font-black text-slate-900 uppercase tracking-tighter">ARCHIVES</h2>
            </div>
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={16} />
              <input type="text" placeholder="FILTER RECORDS..." value={searchHistory} onChange={(e) => setSearchHistory(e.target.value)} className="pl-10 pr-4 py-2 md:py-3 rounded bg-slate-50 border border-slate-200 focus:border-blue-600 focus:ring-0 text-[10px] md:text-[11px] font-black text-slate-900 w-full md:w-[400px] uppercase tracking-widest shadow-inner" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 md:gap-10">
            <div className="flex items-center gap-4 bg-slate-50 p-2 rounded border border-slate-200 shadow-sm w-full md:w-auto">
                <label className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] pl-3 flex items-center gap-2"><CalendarIcon size={12}/> DATE</label>
                <div className="flex items-center gap-2 md:gap-3 flex-1">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-white border border-slate-200 rounded px-2 md:px-4 py-1.5 md:py-2 text-[9px] md:text-[10px] font-black text-slate-900 focus:border-blue-600 outline-none uppercase flex-1" />
                  <span className="text-slate-300 font-bold">—</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-white border border-slate-200 rounded px-2 md:px-4 py-1.5 md:py-2 text-[9px] md:text-[10px] font-black text-slate-900 focus:border-blue-600 outline-none uppercase flex-1" />
                </div>
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                <label className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 whitespace-nowrap"><Wallet size={12}/> TYPE</label>
                <div className="flex gap-2">
                    {['CASH', 'CHEQUE', 'ABANDONED'].map(m => (
                        <button key={m} onClick={() => toggleMethod(m)} className={`px-4 md:px-5 py-1.5 md:py-2 rounded text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all border-2 whitespace-nowrap ${methods.has(m) ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>{m === 'ABANDONED' ? 'VOIDED' : m}</button>
                    ))}
                    <div className="w-px h-8 bg-slate-200 mx-2 hidden md:block" />
                    <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
                      {['ALL', 'ONLY', 'NONE'].map(f => (
                        <button 
                          key={f}
                          onClick={() => setInsuranceFilter(f as any)}
                          className={`px-3 py-1.5 md:px-4 md:py-2 rounded-md text-[8px] md:text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${insuranceFilter === f ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-600'}`}
                        >
                          {f === 'ALL' ? 'INS: ALL' : f === 'ONLY' ? 'INS: ONLY' : 'INS: REGULAR'}
                        </button>
                      ))}
                    </div>
                </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col md:flex-row gap-6 md:gap-10 p-4 md:p-10 overflow-hidden max-w-[1800px] mx-auto w-full">
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-0 md:pr-4 space-y-3">
          {filtered.length > 0 ? filtered.map((ro: any) => (
            <div key={ro.id} onClick={() => onView(ro.id)} className="bg-white px-4 md:px-8 py-4 md:py-5 rounded border border-[#E5E7EB] hover:border-blue-600 transition-all cursor-pointer flex items-center gap-4 md:gap-8 group shadow-sm">
                <div className={`w-10 h-10 md:w-12 md:h-12 rounded flex items-center justify-center shrink-0 border-2 ${ro.paymentMethod === 'ABANDONED' ? 'border-red-100 bg-red-50 text-red-600' : 'border-emerald-100 bg-emerald-50 text-emerald-600'}`}>{ro.paymentMethod === 'CASH' ? <Coins size={12} /> : ro.paymentMethod === 'CHEQUE' ? <Banknote size={12} /> : <Ban size={12} />}</div>
                <div className="w-40 md:w-72 shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-[12px] md:text-[14px] font-black truncate tracking-tight ${ro.urgent ? 'text-red-700' : 'text-slate-900'}`}>{ro.model}</h3>
                    {ro.isInsuranceCase && <Shield size={12} className="text-[#6B4C7A]" />}
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 mt-1"><p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">{ro.id}</p><div className="w-1 h-1 rounded-full bg-slate-200" /><p className="text-[8px] md:text-[9px] font-black text-blue-700 uppercase tracking-widest">{ro.customerName}</p></div>
                </div>
                <div className="flex-1 min-w-0 hidden md:block"><div className="flex flex-col gap-1 overflow-hidden opacity-60">{ro.info.split('\n').filter(Boolean).slice(0, 2).map((line: string, idx: number) => (<p key={idx} className="text-[9px] font-bold text-slate-500 truncate uppercase tracking-wide">• {line}</p>))}</div></div>
                <div className="flex-1 text-right shrink-0"><p className={`text-sm md:text-lg font-black font-mono tracking-tighter ${ro.paymentMethod === 'ABANDONED' ? 'text-red-400 opacity-60' : 'text-emerald-700'}`}>{ro.paymentMethod === 'ABANDONED' ? 'VOID' : `$${ro.paymentAmount?.toFixed(2)}`}</p><p className="text-[7px] md:text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] mt-0.5">{ro.paymentMethod}</p></div>
                {ro.paymentMethod === 'ABANDONED' && (<button onClick={(e) => { e.stopPropagation(); onRestore(ro.id); }} className="p-2 md:p-3 bg-slate-50 text-blue-600 rounded border border-slate-200 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all shadow-sm"><RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>)}
            </div>
          )) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-200 uppercase font-black text-xl md:text-2xl tracking-[0.4em] md:tracking-[0.8em] text-center p-8"><Filter className="w-20 h-20 md:w-[120px] md:h-[120px] mb-6 md:mb-8 opacity-20" />NO MATCHING RECORDS</div>
          )}
        </div>
        <aside className="w-full md:w-[400px] flex flex-col gap-6">
            <div className="bg-white p-6 md:p-8 rounded border-2 border-slate-900 shadow-xl flex flex-col gap-6 md:gap-8 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 md:p-6 opacity-5 group-hover:opacity-10 transition-opacity"><DollarSign className="w-[60px] h-[60px] md:w-[100px] md:h-[100px]" /></div>
                <div><span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">GROSS SETTLEMENT</span><h4 className="text-3xl md:text-5xl font-black text-slate-900 mt-2 md:mt-4 tracking-tighter font-mono">${stats.totalRev.toFixed(2)}</h4></div>
                <div className="space-y-4 md:space-y-6 pt-6 md:pt-8 border-t border-slate-100">
                    <div className="flex justify-between items-center"><span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Coins size={12}/> CASH</span><span className="text-xs md:text-sm font-black text-slate-700 font-mono">${stats.cashSum.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Banknote size={12}/> CHEQUE</span><span className="text-xs md:text-sm font-black text-slate-700 font-mono">${stats.chequeSum.toFixed(2)}</span></div>
                    <div className="flex justify-between items-center pt-1 md:pt-2"><span className="text-[9px] md:text-[10px] font-black text-red-700 uppercase tracking-widest">VOIDED</span><span className="text-xs md:text-sm font-black text-red-600 font-mono">{stats.noRepairCount} UNITS</span></div>
                </div>
                <div className="bg-slate-50 p-4 md:p-6 rounded border border-slate-200 text-center shadow-inner mt-2 md:mt-4"><span className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-[0.3em]">TOTAL RECORDS</span><p className="text-lg md:text-xl font-black text-slate-900 mt-1 tracking-widest">{stats.count}</p></div>
            </div>
        </aside>
      </div>
    </div>
  );
}

function PaymentDialog({ roId, onClose, onSettle }: any) {
  const [amount, setAmount] = useState('0.00');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-2xl p-4 md:p-6 animate-in fade-in duration-300">
      <div className="bg-white border border-slate-200 w-full max-lg rounded-xl p-8 md:p-12 shadow-2xl animate-in zoom-in duration-400">
        <h3 className="text-2xl md:text-3xl font-black text-slate-900 uppercase mb-3 md:mb-4 text-center tracking-tighter">SETTLE TOKEN</h3>
        <p className="text-[9px] md:text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] md:tracking-[0.5em] mb-8 md:mb-12 text-center">ORDER ID: #{roId}</p>
        <div className="mb-8 md:mb-12"><label className="text-[9px] md:text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] mb-3 md:mb-4 block px-2 text-center md:text-left">GROSS AMOUNT ($)</label><input type="number" className="w-full text-4xl md:text-7xl font-black bg-slate-50 border border-slate-200 rounded p-6 md:p-10 text-slate-900 text-center shadow-inner focus:border-blue-600 outline-none font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="space-y-3 md:space-y-4"><button onClick={() => onSettle('CASH', parseFloat(amount) || 0)} className="w-full py-4 md:py-6 bg-emerald-600 text-white rounded font-black text-xs md:text-sm uppercase tracking-[0.2em] md:tracking-[0.3em] shadow-lg border-b-4 border-emerald-800 active:border-b-0 hover:bg-emerald-700 transition-all">SETTLE AS CASH</button><button onClick={() => onSettle('CHEQUE', parseFloat(amount) || 0)} className="w-full py-4 md:py-6 bg-slate-900 text-white rounded font-black text-xs md:text-sm uppercase tracking-[0.2em] md:tracking-[0.3em] shadow-lg border-b-4 border-slate-700 active:border-b-0 hover:bg-slate-800 transition-all">SETTLE AS CHEQUE</button></div>
        <button onClick={onClose} className="mt-8 md:mt-10 w-full py-3 text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] md:tracking-[0.5em] hover:text-slate-900 transition-colors">RETURN TO REPAIR</button>
      </div>
    </div>
  );
}