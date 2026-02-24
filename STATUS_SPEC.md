# Repair Order Status Lifecycle — Authoritative Spec

**Authority:** Postgres `repair_orders.status` CHECK constraint.  
**Rule:** UI must not invent or persist status values outside this set.  
**Single source of truth:** Supabase `repair_orders` table.

---

## 1. Stored status (DB only)

The column `repair_orders.status` accepts exactly:

| DB value       | Meaning (semantic) |
|----------------|--------------------|
| `TO_DO`        | Not yet started; in backlog. |
| `PENDING`      | Acknowledged / waiting (e.g. parts, approval). |
| `IN_PROGRESS`  | Actively being worked on (typically in a bay). |
| `DONE`         | Work completed; not yet settled (payment not recorded). |
| `BODY_WORK`    | Body shop: bodywork stage. |
| `PAINTING`     | Body shop: painting stage. |
| `FINISHING_UP` | Body shop: final assembly / cleanup. |
| `MECHANIC_WORK`| Body shop: mechanic to-do / handoff. |

**Constraint (from schema):**

```sql
CHECK (status IN (
  'TO_DO', 'PENDING', 'IN_PROGRESS', 'DONE',
  'BODY_WORK', 'PAINTING', 'FINISHING_UP', 'MECHANIC_WORK'
))
```

---

## 2. Derived vs stored

| Concept    | Stored? | Definition |
|-----------|--------|------------|
| **Archived / History** | No (derived) | `status = 'DONE'` AND `payment_status IN ('paid', 'voided')`. Shown in History/Archived view; never stored as a status. |
| **Insurance**         | No (flag)   | `is_insurance_case = true`. Filter or badge only; not a status. Same RO appears in one of the status columns. |

- **Archived:** Derived at read time: when deserializing, if `status === 'DONE'` and `payment_status in ('paid','voided')` → show as "Archived" in UI (e.g. History). Writes that "move to archived" must set `status = 'DONE'` and `payment_status = 'paid'` or `'voided'` (and optionally `settled_at` etc.), not a new status.
- **Insurance:** Use only `is_insurance_case`. No `INSURANCE` status in DB; no column that stores "Insurance" as status.

---

## 3. Allowed transitions

Any **stored** status may transition to any other **stored** status when the user moves a card (drag/drop or change status). No extra validation beyond the CHECK constraint.

- **Drag to column X** → one PATCH: set `repair_orders.status` to the value that corresponds to column X (see UI mapping below). No double-writes; no synthetic statuses.
- **Archived:** "Settle" / "Archive" = set `status = 'DONE'`, `payment_status = 'paid'|'voided'` (and related fields). No new status value.
- **Restore from History:** set `payment_status = null` (and optionally `status` to another stored value if desired). Record leaves "Archived" view because the derived condition is no longer true.

Transitions are **finite and minimal**: only the eight values above. No TO_DO → "Insurance" as status; only TO_DO + `is_insurance_case = true` if needed.

---

## 4. UI column mapping

### 4.1 Mechanic shop (`work_type = 'MECHANIC'`)

Columns (in display order) must map 1:1 to these **stored** statuses only:

| Column (order) | DB status    | Notes |
|----------------|-------------|-------|
| Done           | `DONE`      | Work done, not settled. |
| To-do          | `TO_DO`     | Backlog. |
| Pending        | `PENDING`   | Waiting. |
| In Progress    | `IN_PROGRESS` | Active work / in bay. |
| Body Work      | `BODY_WORK` | Handoff to body shop. |

Default column order (e.g. `DEFAULT_*_ORDER`): `[DONE, TODO, PENDING, IN_PROGRESS, BODY_WORK]` (using frontend enum names that map to DB `TO_DO` etc.). No INSURANCE, ORDER_LIST, or ARCHIVED as column identities.

### 4.2 Body shop (`work_type = 'BODY'`)

| Column (order)   | DB status      | Notes |
|------------------|----------------|-------|
| Done             | `DONE`         | |
| To-do            | `TO_DO`        | |
| Bodywork         | `BODY_WORK`    | |
| Painting         | `PAINTING`     | |
| Finishing Up     | `FINISHING_UP` | |
| Mechanic To-do   | `MECHANIC_WORK`| |

Default column order: `[DONE, TODO, BODY_WORK, PAINTING, FINISHING_UP, MECHANIC_WORK]`. Again, only stored statuses.

### 4.3 Other views

- **History / Archived:** A **view** over ROs where `status = 'DONE'` and `payment_status IN ('paid','voided')`. Not a column on the kanban; no drag target "Archived".
- **Insurance:** Filter or badge on existing columns using `is_insurance_case`. No dedicated "Insurance" column that stores a status.

---

## 5. Drag-to-column ↔ DB (1:1)

- **Rule:** One drag = one update to `repair_orders`: set `status` to the DB value for the target column.
- **Allowed target values:** Only the eight stored statuses. Mapping from UI column to DB must be a fixed map (e.g. "Done" column → `DONE`, "To-do" → `TO_DO`, "Body Work" → `BODY_WORK`, …).
- Do not write `INSURANCE`, `ARCHIVED`, or `ORDER_LIST` to `repair_orders.status`. Do not create a "virtual" column that persists as a status.

---

## 6. Frontend enum cleanup (what must be removed/refactored)

- **Remove as status enum values (for workflow/columns/drag):**  
  `INSURANCE`, `ARCHIVED`, `ORDER_LIST`.  
  They must not be used as possible values of `repair_orders.status` or as kanban column identities that persist to DB.

- **Keep only for display/views (not as stored status):**
  - **Archived:** Derive in UI when `status === 'DONE'` and `payment_status in ('paid','voided')`. Type/union can keep an "Archived" view state for History screen only; serialization must never send "ARCHIVED" to DB (must send `DONE` + `payment_status`).
  - **Insurance:** Use only `is_insurance_case` and optional label "Insurance"; no status value.

- **Align frontend enum with DB:**  
  The only status enum values that may be written to or read as `repair_orders.status` are the eight stored values. Prefer one-to-one naming with DB (e.g. `TO_DO` in enum to match DB `TO_DO`); if the app keeps `TODO` for backward compatibility, the serialization layer must map `TODO` ↔ `TO_DO` and never send `INSURANCE`/`ARCHIVED`/`ORDER_LIST` as status.

- **Labels:**  
  `RO_STATUS_LABELS` (or equivalent) should not define labels for `INSURANCE`, `ARCHIVED`, `ORDER_LIST` as workflow columns. Labels for "Archived" and "Insurance" are allowed only for filters, History view, or badges, not as kanban column headers that map to a stored status.

- **Column order state:**  
  `advisorOrder`, `foremanOrder`, `ownerOrder`, `bodyShopOrder` (and any persisted section order) must contain only the eight stored status enum values (or their display aliases). Migration: replace any `INSURANCE`/`ORDER_LIST` in saved order with a stored status (e.g. `BODY_WORK` or `TO_DO`) as per product rules.
