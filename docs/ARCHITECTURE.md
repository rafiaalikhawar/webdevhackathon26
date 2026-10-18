# Architecture and requirement decisions

## Product principle

RESX is a connected CRM whose central responsibility is lead accountability. The interface prioritizes incoming leads, acknowledgment deadlines, recovery and a complete customer view. A restrained light design uses thin borders, compact tables, contextual drawers and touch/keyboard equivalents to drag-and-drop.

## Separation of responsibilities

Presentation → authenticated API → domain services → PostgreSQL repositories/transactions.

A persistent worker processes stored lead deadlines. Provider adapters and an outbox consumer will be separate from domain transactions. External HTTP operations cannot be rolled back with a database transaction, so outbound intent is committed first and delivered later with bounded, idempotent retries.

The current foundation still has some CRM SQL in controllers. Before expanding those controllers, extract the queries to dedicated CRM repositories and use-case services; this is an acknowledged maintainability task, not a completed separation claim.

## Tenant boundary

Global identity: users and sessions. Membership joins identity to one workspace and stores base level, availability, capacity and status. Owner, Admin and User are the base levels. Named roles are configurable bundles of permission codes.

Each tenant-owned entity has a workspace ID. Composite foreign keys include workspace ID, so a valid identifier from another workspace cannot be attached to a local record. Opportunity-stage relationships also include pipeline ID. A non-owner application database role uses forced row-level policies with transaction-local `app.workspace_id`. Identity/workspace membership resolution is separately constrained by the authenticated user in the API.

RLS is an additional workspace boundary, not the record-level permission engine. Server policies enforce permissions, ownership and protected field projection. Field protection must also cover reports, exports, event payloads and audit responses as those surfaces are completed.

## Assignment transaction

All assignment-changing paths acquire the workspace assignment-rule row before lead and membership locks. This serializes routing within a workspace, an appropriate simplicity tradeoff for teams of 5–30 employees. It prevents capacity and round-robin checks from racing across different leads.

A transaction updates the lead owner and deadline, the contact owner, membership assignment position, assignment history, in-app notification, audit event and outbox intent together. A rollback removes all of those writes. The lead version makes stale UI actions explicit.

An acknowledgment clears its deadline. The current assignee must perform it; managers reassign before acknowledging on their own behalf. A recorded note from the assignee can acknowledge the lead. Other acknowledgment actions will use the same domain service when implemented.

The worker reads deadlines from PostgreSQL, not memory timers. Repeated processing rechecks status and deadline under locks. Worker tick failures leave rows available for a later attempt.

## No eligible employee

`current_owner_id` is nullable only when `waiting_for_assignment=true`. `accountable_member_id` is always present. With no available employee below capacity, the workspace Owner is accountable for recovery; there is no ordinary assignment to an unavailable employee. When eligible capacity returns, the worker can route waiting leads that have not exhausted their escalation chain. Exhausted leads require manager intervention.

Current foundation fallback is the workspace Owner. Configurable designated-manager selection is still pending.

## Absence policy

On leave or Offline triggers immediate reassignment of unacknowledged leads in the backend transaction. Acknowledged leads stay with their current owner and require explicit manager review. The preview conservatively blocks absence changes when unacknowledged leads exist because it does not run the backend worker.

## CRM decisions

- Multiple pipelines are included because acceptance criterion F2.3 explicitly requires two, despite the scope summary mentioning one.
- Contacts belong to companies; opportunities belong to contacts and exactly one pipeline/stage pair.
- Populated stages cannot be deleted. Future migration UX can atomically move records before deletion.
- Contacts are archived rather than destructively deleted. Active leads block archival in the current endpoint.
- Opportunity values use integer minor currency units. Mixed currencies are never silently summed.
- Custom fields are pipeline-specific. Stage requirements reference fields from the same pipeline.
- Audit entries are append-only for normal application access. This is not a guarantee against a privileged database administrator.

## Metrics contract for the live implementation

Use the brief's definitions consistently: first response = first assignment to first acknowledgment; escalation = automatic timeout reassignment, separate from manual moves; recovery = overdue, two or more escalations, inactivity or waiting for assignment.

The first preview computes its figures and pipeline distribution from one synthetic dataset. Historical trends are not fabricated.

Live aggregate endpoints remain pending. They must use workspace timezone for day/month boundaries; preserve currency groups; subtract confirmed refunds; filter by permissions before aggregation. Revenue must distinguish paid funds from requests and pipeline value. The glossary's projected revenue formula can double count a linked unpaid opportunity and request; show the components separately until a single counting policy is confirmed.

## Reproducibility

Pinned npm lockfile, PostgreSQL migration, non-secret environment example, Docker database volume, repeatable checks and setup documentation are included. Site source is versioned separately from deployment assets. Credentials stay out of source, browser bundles and logs.
