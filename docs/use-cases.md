# Use cases

Agent Foundry orchestrates specialized agents to tackle professional engineering objectives. Each
scenario below shows how the orchestrator clarifies scope, how reasoning roles decompose work, how
the board fills and executes, what evidence proves completion, which governance gates apply, and
how parallelism and file locks shape the critical path.

## 1. Feature development: multi-tenant row-level security

**Objective**
"Add multi-tenant row-level security to the Postgres-backed API and its admin UI so that each
tenant's data is isolated at the database layer and the UI enforces the isolation."

**Clarification questions**
- "What is the current row-level security strategy, and what does isolation mean for your
  schema?" (Why: the scope of contract changes and the data migration path depends on whether
  RLS is new to this codebase.)
- "Do tenants exist as a concept yet, or do we create a tenancy model first?" (Why: if tenants
  are already structural, this is policy and middleware; if not, it is an architectural change.)
- "What is your downtime tolerance?" (Why: live migration vs scheduled maintenance changes the
  verification strategy and the acceptance criteria.)

**Decomposition**
The architect defines the multi-tenancy model and the public API contract (tenant header
requirements, RLS policies as enforced invariants). The lead owns two modules: database schema
and auth; the API data layer. The analyst breaks each into concrete tasks: database policies,
tenant routing, auth middleware, query building with tenant context, and admin UI filtering.
Each builder implements one task within its declared files.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Define multi-tenant schema | database | | `migrations/`, `schema.sql` | `npm run db:schema:test` | lead |
| TASK-002 | Create RLS policies | database | TASK-001 | `migrations/`, `postgres/policies.sql` | `npm run db:policies:test` | analyst |
| TASK-003 | Extract tenant from request | api-auth | TASK-001 | `src/auth/tenant.ts`, `src/auth/middleware.ts` | `npm test -- auth/tenant` | analyst |
| TASK-004 | Enforce tenant in queries | api-data | TASK-002,TASK-003 | `src/db/client.ts`, `src/types/query.ts` | `npm test -- db/client` | analyst |
| TASK-005 | Admin UI tenant selector | admin-ui | TASK-001 | `web/src/components/TenantSelector.tsx` | `npm run test:web` | analyst |
| TASK-006 | Filter admin queries by tenant | admin-ui | TASK-004,TASK-005 | `web/src/api/client.ts` | `npm run test:web` | analyst |
| TASK-007 | E2E regression: no cross-tenant leaks | ops | TASK-004,TASK-006 | `tests/e2e/` | `npm run e2e` | analyst |

**Evidence (sample content: TASK-004: Enforce tenant in queries)**
Files created: none. Files modified: `src/db/client.ts` (buildQuery now requires tenant_id
param), `src/types/query.ts` (Query interface updated). Commands: `npm test -- db/client`,
`npm run db:test`. Tests: 18 passed (query builders require tenant_id; unauthenticated calls
fail; RLS policy integration test passes). Result: all queries include tenant context; no column
leakage; test output shows zero RLS violations.

**Gates**
Execution (always required): tests must run. Test (always required): all 18 must pass. Review
(always required): code quality. Architecture (downstream ≥ 3 or contract): yes—TASK-004 touches
the public Query interface, a contract change used by TASK-006 and TASK-007. Acceptance
(downstream ≥ 5 or anchors): no—TASK-004 has 2 transitive dependents (TASK-006 and TASK-007),
below the threshold. However, if the architect adds "no cross-tenant leaks ever" as an anchor,
acceptance gate becomes required.

**Parallelism and file locks**
TASK-002 and TASK-003 touch disjoint files (policies vs middleware) and can run in parallel
after TASK-001 completes. TASK-004 waits for both TASK-002 and TASK-003. TASK-005 depends only
on TASK-001 and can run in parallel with TASK-002 and TASK-003. TASK-006 waits for both TASK-004
and TASK-005. TASK-007 depends on both TASK-004 and TASK-006, so it serializes after TASK-006.
Critical path runs: TASK-001 → TASK-002 → TASK-004 → TASK-007, with TASK-003, TASK-005, and
TASK-006 in parallel where dependencies allow. No file locks block this sequence since allowed_files are disjoint.

---

## 2. Large-scale refactor: split notification module into provider adapters

**Objective**
"Replace the monolithic notification module with pluggable provider adapters so we can support
email, SMS and push without duplicating auth, retry logic or persistence."

**Clarification questions**
- "Which providers do you target today, and which are planned?" (Why: the contract for the
  adapter interface and the test suite scope depend on the provider list.)
- "Do you run the old and new paths in parallel during cutover, or do we schedule downtime?"
  (Why: canary testing and rollback strategy change if both must coexist.)
- "How many sites depend on the notification module, and who owns them?" (Why: if multiple
  teams own dependents, this escalates to architect for cross-team coordination.)

**Decomposition**
The architect defines the adapter interface as a public contract, the provider registry, and the
cutover strategy. The lead owns the adapter framework (base class, registry, retry policy) and
each provider (email, SMS, push) as separate modules. The analyst decomposes each into tasks:
adapter interface, concrete implementations, migration from old calls, integration tests, and
canary rollout. The builder implements adapters and wiring within declared files.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Define provider adapter interface | framework | | `src/notifications/adapter.ts`, `src/types/provider.ts` | `npm test -- types/provider` | lead |
| TASK-002 | Implement registry and loader | framework | TASK-001 | `src/notifications/registry.ts`, `src/notifications/loader.ts` | `npm test -- registry` | analyst |
| TASK-003 | Email provider adapter | providers | TASK-001,TASK-002 | `src/providers/email.ts` | `npm test -- providers/email` | analyst |
| TASK-004 | SMS provider adapter | providers | TASK-001,TASK-002 | `src/providers/sms.ts` | `npm test -- providers/sms` | analyst |
| TASK-005 | Push provider adapter | providers | TASK-001,TASK-002 | `src/providers/push.ts` | `npm test -- providers/push` | analyst |
| TASK-006 | Migrate old notify() calls to adapters | migration | TASK-003,TASK-004,TASK-005 | `src/api/routes/notifications.ts`, `src/jobs/notify.ts` | `npm test -- migration` | analyst |
| TASK-007 | Contract tests: all providers | testing | TASK-003,TASK-004,TASK-005 | `tests/contract/provider.test.ts` | `npm run test:contract` | analyst |
| TASK-008 | Canary: 10% traffic, observe | ops | TASK-006,TASK-007 | `config/canary.json`, `scripts/canary.sh` | `bash scripts/canary.sh` | lead |

**Evidence (sample content: TASK-003: Email provider adapter)**
Files created: `src/providers/email.ts`. Files modified: none (adapter interface already exists).
Commands: `npm test -- providers/email`, `npm run integration:email`. Tests: 22 passed (SMTP
connect, message formatting, retry backoff, failure callback). Result: adapter implements full
interface; all test cases green.

**Gates**
Execution (always): must run tests. Test (always): 22 must pass. Review (always): adapter
quality and security. Architecture (downstream ≥ 3 or contract): yes—TASK-003 has 3 transitive
dependents (TASK-006, TASK-007, TASK-008), reaching the architecture threshold. Acceptance
(downstream ≥ 5 or anchors): no—downstream count 3 is below the ≥5 threshold. However, if the
lead anchors "no message loss in retry", acceptance gate becomes required.

**Parallelism and file locks**
TASK-003, TASK-004, and TASK-005 have disjoint files and can run in parallel after TASK-001
and TASK-002 complete. TASK-006 depends on all three providers and must wait for them. TASK-007
runs in parallel with TASK-006 since they have disjoint dependencies and test files. TASK-008
waits for both TASK-006 and TASK-007. Tasks with overlapping allowed_files are serialized by
file locks; here all provider adapters are independent. Critical path flows through the
sequential setup (TASK-001 → TASK-002) then parallel providers, then migration, then canary
observation.

---

## 3. Technology migration: React 17 + Webpack to React 19 + Vite

**Objective**
"Upgrade the front end from React 17 + Webpack to React 19 + Vite without changing the
application's behavior, and land all tests green."

**Clarification questions**
- "What does 'without changing behavior' mean—API contracts only, or also CSS and DOM
  structure?" (Why: if visual regression is in scope, QA gates grow and acceptance criteria
  become strict.)
- "Are there custom Webpack loaders or plugins we have to replicate?" (Why: if custom loaders
  exist, this is a scoping question for the architect.)
- "How many routes and features are there, and do all have test coverage?" (Why: the
  verification command set depends on coverage; missing tests block the migration.)

**Decomposition**
The architect assesses breaking changes between React versions and defines acceptance criteria
around behavior equivalence. The lead owns two modules: build configuration and app code. The
analyst breaks the work into tasks: Vite setup, dependency updates, async boundary fixes
(Suspense), hook compatibility, test runner migration, and visual regression testing. The
builder implements changes within declared files.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Set up Vite and dev config | build | | `vite.config.ts`, `tsconfig.json` | `npm run dev` | lead |
| TASK-002 | Update React deps to v19 | build | TASK-001 | `package.json`, `package-lock.json` | `npm ls react` | analyst |
| TASK-003 | Remove Webpack loaders; migrate assets | build | TASK-002 | `vite.config.ts`, `public/`, `web/src/` | `npm run build` | analyst |
| TASK-004 | Update Suspense boundaries and lazy load | app-code | TASK-001 | `web/src/routes/`, `web/src/components/` | `npm test` | analyst |
| TASK-005 | Replace deprecated hooks and APIs | app-code | TASK-002 | `web/src/hooks/`, `web/src/context/` | `npm test` | analyst |
| TASK-006 | Migrate tests to Vitest | testing | TASK-001,TASK-002 | `vitest.config.ts`, `tests/`, `web/src/**/*.test.ts` | `npm run test:web` | analyst |
| TASK-007 | Visual regression: all pages | testing | TASK-006,TASK-005 | `tests/visual/`, `tests/screenshots/` | `npm run test:visual` | analyst |

**Evidence (sample content: TASK-004: Update Suspense boundaries)**
Files modified: `web/src/routes/Dashboard.tsx`, `web/src/routes/Settings.tsx`,
`web/src/components/AsyncWidget.tsx`. Commands: `npm test`, `npm run dev`. Tests: 34 passed
(Suspense boundary render, error fallback, data loading lifecycle). Result: all async code
wrapped in Suspense; no hydration mismatches; fallback UI renders while loading.

**Gates**
Execution (always): tests run. Test (always): 34 must pass. Review (always): code quality,
breaking change review. Architecture (downstream ≥ 3 or contract): TASK-005 has 1 downstream
(TASK-007). TASK-004 has 1 downstream (TASK-007). Neither exceeds the threshold. If the
Suspense/hook changes touch the component API contract used by external modules, the
architecture gate applies. Acceptance (downstream ≥ 5 or anchors): no downstream > 5 unless UI
team adds "visual equivalence to v17" as an anchor.

**Parallelism and file locks**
TASK-001 and TASK-002 form a build setup sequence. TASK-003 must wait for TASK-002. TASK-004
depends only on TASK-001, so it can start immediately after setup. TASK-005 depends on TASK-002
and can run parallel with TASK-003 and TASK-004 since they modify disjoint file sets. TASK-006
depends on TASK-001 and TASK-002. TASK-007 depends on TASK-006 and TASK-005. Critical path
flows: TASK-001 → TASK-002 → TASK-003 and TASK-005, converging at TASK-006 → TASK-007. No file
locks block this sequence since each task's allowed_files are disjoint.

---

## 4. Production debugging: intermittent 502s with regression tests

**Objective**
"Diagnose intermittent 502 errors at the API gateway, identify the root cause, fix it, and land
regression tests so it does not happen again."

**Clarification questions**
- "What is the error rate and time-of-day pattern?" (Why: rate and pattern narrow the suspect
  list to specific codepaths or infrastructure.)
- "Do you have logs and traces available, or do we instrument first?" (Why: if instrumentation
  is needed, this is a scoping change; if traces exist, we focus on analysis.)
- "What do downstream services depend on this endpoint?" (Why: this determines acceptance
  criteria and whether this is a public contract breach.)

**Decomposition**
The architect reviews the infrastructure and API contract to scope the blast radius. The lead
owns the API module and the infrastructure logging. The analyst prioritizes: review logs and
traces, identify the failing service, write a failing test that reproduces the issue, implement
the fix, add regression tests. The builder analyzes logs, writes tests, and implements the fix.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Analyze logs and identify root cause | ops | | `scripts/analyze-logs.sh`, `docs/incident-analysis.md` | `bash scripts/analyze-logs.sh` | analyst |
| TASK-002 | Reproduce 502 in staging environment | testing | TASK-001 | `tests/regression/`, `scripts/load-test.sh` | `bash scripts/load-test.sh` | analyst |
| TASK-003 | Write failing test case | testing | TASK-001,TASK-002 | `tests/regression/502-race.test.ts` | `npm test -- regression/502` | analyst |
| TASK-004 | Implement fix (e.g., connection pool, timeout) | api | TASK-001 | `src/db/pool.ts` or `src/http/client.ts` | `npm test -- db/pool` | analyst |
| TASK-005 | Verify fix in staging | testing | TASK-004 | `scripts/load-test.sh`, `scripts/metrics.sh` | `bash scripts/metrics.sh` | analyst |
| TASK-006 | Regression test suite | testing | TASK-003,TASK-004 | `tests/regression/502-*.test.ts`, `tests/load/` | `npm run test:regression` | analyst |

**Evidence (sample content: TASK-004: Implement fix)**
Files modified: `src/db/pool.ts` (connection pool size increased, timeout reduced). Commands:
`npm test -- db/pool`, `npm run dev` (manual staging test), `bash scripts/load-test.sh`. Tests:
8 passed (pool respects ceiling; timeout triggers before 502; new connections queue properly).
Result: zero 502s observed in load test; pool metrics show stable connection count; response
latency remains within acceptable bounds.

**Gates**
Execution (always): tests run. Test (always): 8 must pass. Review (always): fix approach and
risk assessment. Architecture (downstream ≥ 3 or contract): yes—if this is a public API
endpoint, downstream services depend on it. TASK-004 has 2 transitive dependents (TASK-005 and
TASK-006), but the "contract" criterion applies since timeout behavior may change. Acceptance
(downstream ≥ 5 or anchors): depends on team; if "zero 502 recurrence" is anchored, acceptance
gate required.

**Parallelism and file locks**
TASK-001 (analysis) must run first; it blocks TASK-002 and TASK-003. TASK-002 and TASK-003 can
overlap since they work on disjoint files (staging reproduction and test code). TASK-004 must
wait for TASK-003. TASK-005 waits for TASK-004. TASK-006 waits for TASK-003 and TASK-004 to
ensure the fix is tested. Files are disjoint (logs/scripts vs test vs pool config) so no locks
prevent parallelism where dependencies allow. Critical path is linear through analysis → fix →
verification with test writing in parallel to reproduction.

---

## 5. Architecture review: payments module boundaries with remediation plan

**Objective**
"Review the payments module for boundary violations—cross-cutting dependencies, hidden
contracts, and data leaks—then produce a prioritized remediation plan."

**Clarification questions**
- "What are the declared boundaries of the payments module, and what modules is it supposed to
  interact with?" (Why: without a declared architecture, "violation" is subjective; this
  clarifies the standard.)
- "Do you want to understand the current state first (architecture review), or jump to a plan?"
  (Why: review takes more time but produces evidence; if you want action, we start with
  remediation proposals.)
- "Are there performance or security concerns driving this, or is it general hygiene?" (Why: if
  there is a concrete concern, that becomes an anchor for acceptance criteria.)

**Decomposition**
The architect leads this task, consulting the graph of dependencies and the codebase. The lead
analyzes the payments module structure. The analyst collects evidence: call graphs, data flows,
public vs private contracts. The builder runs the analysis tools and documents findings. The
output is a remediation plan (a reasoning-role plan artifact), not executable tasks.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Map payments module dependencies | analysis | | `scripts/graph-deps.sh`, `docs/payments-graph.md` | `bash scripts/graph-deps.sh` | analyst |
| TASK-002 | Identify cross-module data flows | analysis | TASK-001 | `scripts/trace-data-flow.sh`, `docs/data-flows.md` | `bash scripts/trace-data-flow.sh` | analyst |
| TASK-003 | Audit public vs private contracts | analysis | TASK-001 | `docs/payments-contracts.md` | `grep -r '@public\|@private' src/payments/` | analyst |
| TASK-004 | Detect undeclared dependencies | analysis | TASK-001,TASK-002 | `scripts/unused-exports.sh`, `docs/violations.md` | `bash scripts/unused-exports.sh` | analyst |
| TASK-005 | Document findings and risk assessment | analysis | TASK-002,TASK-003,TASK-004 | `docs/payments-architecture-review.md` | `cat docs/payments-architecture-review.md` | lead |

**Evidence (sample content: TASK-004: Detect undeclared dependencies)**
Files created: `docs/violations.md`. Commands: `bash scripts/unused-exports.sh`, `grep -r
'import.*from.*payments' src/`. Tests_executed: analysis scripts (both ran). Result: found 12
undeclared imports from orders module into payments internals; found 3 public methods with no
callers outside the module (deadwood); identified 1 circular dependency through cache layer.

**Gates**
Execution (always): analysis commands run. Test (always): none for analysis; verification
command execution itself is the evidence. Review (always): accuracy of findings. Architecture
(always): this IS an architecture review by role. Acceptance (if anchored): if the architect or
lead anchors specific violations as critical (e.g., "circular dependency must resolve"),
acceptance gate required; otherwise, skipped (this is a planning artifact, not a live system
change).

**Parallelism and file locks**
TASK-001 must run first (dependency graph). TASK-002, TASK-003, and TASK-004 all depend on
TASK-001 but touch disjoint analysis scripts and docs; they can run in parallel. TASK-005
(summary write) waits for TASK-002, TASK-003, and TASK-004. Critical path is: TASK-001 then
parallel execution of TASK-002/003/004 then TASK-005. No file locks (all outputs are
documentation and analysis scripts).

**Output (from architect after reviewing the findings)**
Plan submitted by architect with scope "Payments module decoupling." Proposals include: (1)
Expose orders-to-payments contract explicitly; (2) Break circular dependency via cache
abstraction; (3) Mark deadwood methods for removal. Risks: (1) Contract exposure may reveal
implementation details; (2) cache abstraction may impact performance. Acceptance criteria
anchored: "zero undeclared imports after remediation."

---

## 6. Data pipeline: ingestion with backfill

**Objective**
"Build an event ingestion pipeline that validates raw events into a warehouse, aggregates them
into hourly tables, and backfills missing data from the past 30 days."

**Clarification questions**
- "What is the source of raw events, and what does a valid event look like?" (Why: the schema
  and validation rules determine the scope of the ingestion layer and the test data.)
- "What aggregates do you need—counts, sums, timeseries?" (Why: aggregation queries and table
  schemas depend on the metric set.)
- "Do you backfill in background, or does it block the pipeline?" (Why: backfill strategy
  affects scheduling and acceptance criteria.)

**Decomposition**
The architect defines the data model and the warehouse schema. The lead owns the ingestion
module and aggregation module. The analyst breaks the work into tasks: event schema validation,
ingestion service, aggregation logic, backfill logic, and integration tests. The builder
implements each task within declared files.

**Board**
| id | title | module | depends_on | allowed_files | verification | owner |
|---|---|---|---|---|---|---|
| TASK-001 | Define event schema and validation rules | schema | | `src/events/schema.ts`, `src/events/validator.ts` | `npm test -- events/schema` | lead |
| TASK-002 | Implement event ingestion service | ingestion | TASK-001 | `src/ingestion/service.ts`, `src/db/migrations/events_table.sql` | `npm test -- ingestion/service` | analyst |
| TASK-003 | Create warehouse aggregation tables | schema | TASK-001 | `src/db/migrations/hourly_agg.sql` | `npm run db:migrate` | analyst |
| TASK-004 | Implement aggregation logic | aggregation | TASK-003 | `src/aggregation/hourly.ts` | `npm test -- aggregation/hourly` | analyst |
| TASK-005 | Implement backfill logic | backfill | TASK-002,TASK-004 | `src/backfill/backfill.ts`, `scripts/run-backfill.sh` | `bash scripts/run-backfill.sh --dry-run` | analyst |
| TASK-006 | Integration: ingest + aggregate + backfill | testing | TASK-002,TASK-004,TASK-005 | `tests/integration/pipeline.test.ts` | `npm test -- integration/pipeline` | analyst |
| TASK-007 | Load test: high-volume event throughput | testing | TASK-002,TASK-006 | `tests/load/ingestion.test.ts` | `npm run test:load` | analyst |

**Evidence (sample content: TASK-005: Implement backfill logic)**
Files created: `src/backfill/backfill.ts`, `scripts/run-backfill.sh`. Files modified:
`src/db/migrations/hourly_agg.sql` (added backfill tracking column). Commands: `bash
scripts/run-backfill.sh --dry-run`, `npm test -- backfill`. Tests: 16 passed (backfill fetches
events in 1-hour chunks; aggregates correctly for each hour; marks hour as backfilled; resume
after crash). Result: dry-run backfill processes 30 days of data; data matches live aggregation;
zero duplicates observed.

**Gates**
Execution (always): tests run. Test (always): 16 must pass. Review (always): data integrity and
backfill correctness. Architecture (downstream ≥ 3 or contract): TASK-005 has 2 transitive
dependents (TASK-006 and TASK-007), below the ≥3 threshold. The architecture gate applies only
if the backfill logic touches a warehouse schema contract or if downstream count exceeds 3.
Acceptance (downstream ≥ 5 or anchors): if the analyst anchors "no backfill duplicates ever",
acceptance gate required.

**Parallelism and file locks**
TASK-001 (schema) runs first. TASK-002 and TASK-003 both depend on TASK-001 but touch disjoint
files (ingestion service vs warehouse migrations); they can run in parallel. TASK-004 waits for
TASK-003. TASK-005 waits for both TASK-002 and TASK-004. TASK-006 waits for TASK-005 since it
integrates all three components. TASK-007 waits for TASK-006. Critical path flows: TASK-001 →
TASK-002 + TASK-003 (parallel) → TASK-004 → TASK-005 → TASK-006 → TASK-007. No file locks
since allowed_files are disjoint across tasks.

---

## Summary

These six scenarios span feature development, large-scale refactoring, technology migration,
production debugging, architecture review, and data engineering. Each shows how clarification
gates real ambiguity before planning, how reasoning roles decompose work, how the board
transitions through statuses, what evidence proves task completion, which review gates apply
based on blast radius and contracts, and how parallelism and file locks shape execution flow.
The orchestrator coordinates all of this, keeps every role in its lane, and surfaces only the
critical facts to chat.
