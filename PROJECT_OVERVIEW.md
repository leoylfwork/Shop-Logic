1. Product Purpose
This project is a workflow management SaaS designed for automotive repair businesses, including both mechanic shops and body shops.
The system focuses on real-time multi-role collaboration around Repair Orders (RO).It replaces traditional shop whiteboards and messaging by providing a synchronized Kanban workflow with operational tracking, communication logs, and AI-assisted diagnostics.
The current implementation is a frontend prototype built in Google AI Studio.Backend services (database, auth, realtime sync) will be added later.

2. Operational Modes
The application has two independent operation modes:
Mechanic Shop Mode
Used for mechanical repair workflow and insurance claims processing.Supports multiple staff roles collaborating on the same Repair Orders.
Body Shop Mode
Used for collision repair workflow.Currently simplified and accessible only by Owner role.
The two modes must remain logically separated in data and workflow.

3. User Roles
Advisor
* Creates Repair Orders
* Uploads insurance files and attachments
* Communicates with customer and insurance
* Handles payment and closing process
Foreman
* Controls repair progress
* Assigns vehicles into Bays (work stations)
* Manages repair timing and shop capacity
Owner
* Full system visibility
* Configuration and monitoring
* Access to body shop workflow

4. Core Workflow Concept
The entire system revolves around a shared Kanban board representing the lifecycle of a Repair Order.
Users collaborate in real time.UI updates are event-driven (notifications, highlight changes).
Every Repair Order acts as a shared workspace containing:
* status
* vehicle info
* files
* messages
* activity history
* AI analysis

5. Mechanic Shop Workflow
Kanban Statuses
TO-DOPENDINGIN PROGRESSDONEINSURANCE
Insurance Orders
Insurance Repair Orders behave differently from normal orders:
* They permanently remain visible in the INSURANCE column
* They also appear in their current progress column
* Column color reflects repair status
Completion Logic
After reaching DONE:The order enters "Finalize & Collect" stage.
Only after payment is completed:The order moves to History (archived state)

6. Body Shop Workflow
Statuses:
ALLTO-DOWAITING FOR PARTSBODYWORKPAINTINGFINISHING UPMECHANIC WORKDONE
This workflow is currently simplified and Owner-focused.

7. Core Features
Repair Order Detail Page
Each RO contains a real-time shared activity log including:
* operational actions
* communications
* updates
All roles can view the log.

AI Diagnosis
The system will use the OpenAI API (proxied via Vercel Serverless; no Gemini).
AI analyzes:
* Repair Order information
* Attachments
* Update history
Purpose: assist technicians in identifying possible issues.

Attachment Management
High-frequency upload support for insurance workflow:photos, documents, estimates.

VIN Integration
Users scan VIN via camera.
Process:scan → extract VIN → decode via backend API
Vehicle specifications are displayed directly in the card.

Bay Management (Shop Capacity Control)
Foreman assigns vehicles into Bays.
Moving a card into a Bay:starts time tracking
Used to monitor active workload.

8. Planned Backend Capabilities
The frontend currently simulates data. The future backend will use:
* Supabase: authentication (Supabase Auth), persistent database (Postgres), and realtime synchronization (Supabase Realtime). Role-based access control via RLS and API checks.
* OpenAI API: AI diagnosis and VIN decoding, proxied via Vercel Serverless (e.g. /api/ai/diagnostic, /api/ai/decode-vin); API keys stay on the server, not in the frontend.
* Google Calendar: bidirectional sync — appointments in Google Calendar can create or update To-Do orders; scheduling in CK-Flow can create or update events in Google Calendar (Google Calendar API + OAuth; token storage and event read/write via Vercel Serverless or Supabase as needed).

9. Future Features
Invoice System
Automatically generate invoice from:
* parts used
* labor time
Triggered during DONE stage.

Google Calendar Integration (target)
Bidirectional sync with Google Calendar:
* Appointment in Google Calendar → create or update To-Do order in CK-Flow.
* Order scheduling in CK-Flow → create or update event in Google Calendar.
Implementation: Google Calendar API + OAuth; token storage and event read/write via backend (Vercel Serverless or Supabase).

10. System Design Philosophy
The system is not a generic CRM.It models the real operational behavior of an automotive shop.
Key principles:
* status-driven workflow instead of forms
* shared live workspace per vehicle
* operational visibility over reporting
* AI assistance embedded into workflow rather than separate tool




