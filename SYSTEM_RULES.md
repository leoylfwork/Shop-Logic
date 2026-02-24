1. Core Design Principle
This system is a state-driven operational workflow, not a generic CRUD system.
Database structure, permissions, and realtime events must always respect workflow behavior.
RepairOrder is the central entity.All actions are operations performed around a RepairOrder.

2. Entities
The backend must support at minimum the following logical entities:
* User
* RepairOrder
* EventLog
* Message
* Attachment
* Vehicle
* Bay
* Payment (logical state)
The system must be extendable without schema rewrite.

3. Modes Separation
Two operational modes exist:
* mechanic_shop
* body_shop
Rules:
1. Data between modes must not mix.
2. A RepairOrder belongs to exactly one mode.
3. Queries must always filter by mode.

4. Roles
Roles:
* advisor
* foreman
* owner
A user has exactly one role.

5. RepairOrder Lifecycle (Mechanic Mode)
Status Enum
TO_DOPENDINGIN_PROGRESSDONE
Special Virtual Column
INSURANCE is NOT a status.It is a filtered view of orders where:
type = insurance
Insurance orders appear in two places simultaneously:
* INSURANCE column
* Their actual status column


7. Completion Rule
A RepairOrder reaching DONE enters "collecting" phase.
Archiving condition:
status = DONE AND payment_status = paid
Only then it becomes archived/history.

8. Permissions
Advisor
Allowed:
* create RepairOrder
* change RepairOrder status
* upload attachments
* send messages
* mark payment_status
Not allowed:
* assign bays

Foreman
Allowed:
* change RepairOrder status
* upload attachments
* send messages
* assign/remove Bay
* control workflow progression
Not allowed:
* finalize payment

Owner
Full access to all operations.

9. Bay Logic
A Bay represents an active working slot.
Rule:
Moving a RepairOrder into a Bay starts timing.Removing it stops timing.
A RepairOrder can occupy at most one Bay at a time.

10. Event Log Rules
Every state change must produce an EventLog entry.
Examples:
* status change
* bay assignment
* payment recorded
* attachment uploaded
EventLog is append-only and immutable.
The backend writes EventLog entries when processing actions; the frontend only sends business actions (e.g. update status, assign bay) and does not write log entries directly to the backend.

11. Messaging Rules
Messages belong to a RepairOrder.
All roles can read all messages of that order.
Messages are realtime synchronized across connected clients.

12. AI Context Rules
AI input context must include:
* RepairOrder core fields
* Vehicle decoded data
* EventLog history
* Attachments metadata
AI must never mutate database state directly.
AI outputs are suggestions only.

13. Realtime Behavior
The following events must trigger realtime updates:
* new message
* status change
* bay change
* payment update
* attachment upload
Realtime updates must be scoped per RepairOrder.

14. History Definition (Scheme A — adopted)
History is NOT a separate status. The backend does not store an ARCHIVED status.
History = records where:
status = DONE AND payment_status IN ('paid', 'voided')
The frontend may display these as "Archived" or "History"; the backend exposes them via this query only.

15. Future Compatibility Constraints
Schema must support:
* invoice generation from events
* calendar scheduling linkage
* multi-tenant shops
Design must avoid hardcoding columns that block expansion.


