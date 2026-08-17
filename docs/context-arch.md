# Architecture & Technical Specification

Dokumen teknis platform commerce WhatsApp multi-merchant: struktur repo, stack, komponen, alur data, dan konvensi. Sinkron dengan `docs/context.md` (PRD).

## 1. Prinsip Arsitektur

- **Satu codebase, banyak tenant.** Tidak ada aplikasi per merchant. Merchant baru di-onboard ke platform yang sama.
- **`tenant_id` sebagai boundary utama.** Hampir semua data bisnis di-scope per tenant.
- **AI membantu, bukan sumber kebenaran.** Order/payment/status dari service + state machine.
- **Provider-agnostic via boundary stabil.** Provider eksternal (WhatsApp, payment, courier) diisolasi lewat kontrak kecil. Adapter hanya ditambah saat provider kedua benar-benar dibutuhkan — bukan membangun abstraction framework prematur.
- **Idempotency via database.** Unique constraint + transaction, bukan framework generik.
- **Outbound lewat outbox queue.** Tidak ada kirim pesan synchronous dari fungsi AI.

## 2. Struktur Monorepo (target)

```
soysu/
├── .moon/                     # moon repo config (workspace, toolchains, tasks)
├── apps/
│   ├── bot/                   # Agent worker (Anvia) — memproses percakapan per tenant
│   │   ├── knowledge/         # knowledge base (dev seed; production per tenant)
│   │   └── src/
│   │       ├── agent.ts       # AgentBuilder + tools
│   │       ├── tools.ts       # createTool: rag_search, check_stock, cart_manager, checkout, dll.
│   │       └── index.ts       # worker entry
│   ├── gateway-api/           # Messaging gateway: webhook inbound + outbound sender
│   │   └── src/               # normalize, dedup, resolver, provider clients
│   ├── admin-api/             # Merchant/Admin BE (Hono)
│   │   └── src/index.ts       # REST per tenant
│   ├── admin-web/             # Merchant workspace (Vite + React + TS)
│   └── webhook-worker/        # (opsional) ingestion terpisah bila trafik naik
├── packages/
│   ├── database/              # Drizzle schema, migrations, services (tenant-aware)
│   ├── messaging/             # domain message + provider adapters (meta-cloud-api, bsp, baileys-dev)
│   ├── commerce/              # catalog, cart, order, checkout service
│   ├── payments/              # payment domain: create, proof, verify, expire
│   ├── fulfillment/           # delivery handoff domain; courier integration deferred
│   ├── rag/                   # chunker, embedder, pgvector retriever (tenant-aware)
│   └── shared/                # shared types + constants
├── docs/                      # PRD & arsitektur
├── AGENTS.md
└── moon.yml
```

### Pemisahan process (awal)

- **apps/bot** = agent worker, stateless per job, memproses burst conversation.
- **apps/gateway-api** = inbound webhook + outbound sender; stateless, bisa di-scale horizontal.
- **apps/admin-api** = stateless, menangani CRUD merchant, inbox, order, payment, delivery, RBAC.
- **Platform operator dashboard** memakai API yang sama dengan role platform-level untuk onboarding, support, usage, cost, dan health.
- Semua berbagi database; tidak berbagi proses.
- Untuk trafik awal, `gateway-api` dan `admin-api` boleh satu process; dipisah saat webhook butuh scaling independen.

## 3. Tech Stack

| Lapisan          | Pilihan                                | Catatan                      |
| ---------------- | -------------------------------------- | ---------------------------- |
| Runtime          | Node.js 22 (ESM, TS native)            | dijalankan via tsx           |
| Package manager  | pnpm 11 (workspace)                    | `workspace:*`                |
| Build system     | moonrepo v2                            | toolchain via proto          |
| Agent framework  | Anvia (`@anvia/core`, `@anvia/openai`) | AgentBuilder + createTool    |
| LLM provider     | OpenAI                                 | model via env `OPENAI_MODEL` |
| Embeddings       | `text-embedding-3-small`               | untuk RAG                    |
| Admin BE         | Hono (`@hono/node-server`)             | REST API                     |
| Admin FE         | Vite + React + TS                      | SPA                          |
| Validasi         | zod v4                                 | schema input tool & request  |
| Formatter/Linter | oxfmt + oxlint                         | root task moon               |
| Storage          | PostgreSQL + pgvector, Redis, object storage | bukti/media file        |

## 4. Komponen

### 4.1 Messaging Gateway (apps/gateway-api)

**Inbound (webhook):**

```text
Meta/BSP webhook
  → verify signature/token
  → simpan raw event (opsional)
  → resolve channel_account dari phone_number_id
  → resolve tenant
  → dedup (channel_account_id + external_message_id unique)
  → normalize ke InboundMessage
  → persist conversation + message
  → enqueue ke debounce/queue
  → agent / human inbox
```

**Outbound (outbox):**

```text
Agent/Human CS membuat OutboundMessage
  → simpan ke outbound_messages (status queued)
  → worker kirim ke provider
  → simpan provider message id
  → update status sent/delivered/read/failed (dari webhook delivery)
```

Kontrak minimal:

```ts
interface ChannelAdapter {
  receiveEvent(event: unknown): Promise<void>;
  sendText(message: OutboundMessage): Promise<SendResult>;
  sendMedia(message: OutboundMediaMessage): Promise<SendResult>;
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
}
```

Business logic TIDAK boleh mengetahui: format payload Meta, Baileys JID, payload BSP, mekanisme QR pairing.

Provider:

```text
apps/gateway-api/src/providers/
├── meta-cloud-api/
├── bsp/
└── baileys-dev/       # development/testing saja, tanpa SLA production
```

### 4.2 Agent Worker (apps/bot)

- Membaca job burst dari Redis/queue.
- Load tenant context + session.
- Memanggil tools commerce/RAG dengan tenant context.
- Response disimpan dan dikirim lewat outbox.

### 4.3 RAG (packages/rag)

- Tenant-aware: dokumen knowledge base di-scope per tenant.
- Pipeline: ingest → chunk → embed → simpan; retrieve → dense + sparse → merge.
- Stock/harga TIDAK berasal dari RAG; selalu dari tool commerce ke database.

### 4.4 Admin API (apps/admin-api)

- Endpoint per tenant; RBAC; audit log.
- Menangani: dashboard, inbox, orders, payments, products, stock, delivery, customers, knowledge, whatsapp setup, team & roles, settings.
- Webhook payment dipisah sesuai kebutuhan.

### 4.5 Admin Web (apps/admin-web)

- Merchant workspace SPA. Proxy `/api` → `admin-api`.

## 5. Data Layer

### 5.1 Tenant & Channel

```text
tenants
- id, name, slug, status, settings(jsonb), created_at

tenant_users
- tenant_id, user_id, role (admin|operator|viewer), status

channel_accounts
- id, tenant_id, channel, provider
- external_account_id (phone_number_id / account id provider)
- phone_number, status, credential_reference, last_error
```

Status `channel_accounts`:

```text
pending | verification_required | migration_required | provisioning
connected | failed | suspended
```

### 5.2 Messaging

```text
conversations
- id, tenant_id, channel_account_id, customer_id, status, last_message_at

messages
- id, tenant_id, conversation_id, role (user|bot|human)
- provider_message_id, direction (inbound|outbound)
- text, media, status, created_at
- unique (channel_account_id, provider_message_id) — inbound dedup

outbound_messages
- id, tenant_id, conversation_id, channel_account_id
- payload(text/media/template), idempotency_key
- status (queued|sending|sent|delivered|read|failed)
```

### 5.3 Commerce

```text
products
- id, tenant_id, name, flavor/variant, price, stock, active

carts / cart_items
- unique per tenant + conversation; qty; variant; expiry

orders
- id, tenant_id, conversation_id, customer_id
- status, payment_method, payment_status, shipping, total, snapshot harga

order_items
- snapshot nama, variant, qty, unit_price

payments
- id, tenant_id, order_id, method, amount, status
- proof_message_id, proof_file_path, verified_by, verified_at, expired_at

payment_configs
- id, tenant_id, method, display_name, qris_image/payload, bank fields, instructions, active
```

### 5.4 Delivery Handoff

```text
delivery_handoffs
- id, tenant_id, order_id, area, address, shipping_cost
- status (pending_handoff|handed_to_merchant|completed|failed)
- external_reference?, notes, created_at
```

Pada MVP merchant mengatur GoSend atau kurirnya sendiri di luar flow platform. Dispatch, tracking otomatis, driver app, dan COD settlement ditunda.

### 5.5 Platform Operations & AI Tracing

```text
platform_users
- id, email, role (owner|support|engineer), status

usage_events
- tenant_id, type (message|llm_run|tool_call|storage), quantity, cost_estimate, created_at

billing_records
- tenant_id, period, platform_fee, usage_fee, provider_fee, status

ai_runs
- tenant_id, conversation_id, model, prompt_reference, response
- tool_calls, retrieval_scores, latency_ms, input_tokens, output_tokens, error
```

Isi sensitif yang tidak diperlukan tidak disimpan. Akses operator ke tracing/chat harus diaudit.

### 5.6 RAG, Notification, Audit

```text
kb_documents / kb_versions / kb_chunks      # + tenant_id
notifications                                # + tenant_id
audit_logs                                   # tenant_id, actor, action, entity, data
```

## 6. Payment Domain

Tidak ada abstraction provider pada MVP. Domain internal:

```text
createPayment()
attachProof()
markPaid()
rejectPayment()
expirePayment()
```

State:

```text
payment_status: pending | proof_submitted | paid | rejected | expired | not_required
```

Ketika payment gateway ditambahkan nanti, perubahannya hanya di boundary webhook → service yang sama. Domain order/payment tidak berubah.

## 7. Idempotency

- Inbound message: unique `(channel_account_id, provider_message_id)`.
- Order creation: unique `(tenant_id, conversation_id, checkout_request_id)`.
- Payment verification: hanya boleh berubah dari `pending`/`proof_submitted` sekali.
- Outbound: `idempotency_key` per kirim; retry mengembalikan hasil sebelumnya.
- Semua dalam database transaction.

## 8. Konvensi & Lingkungan

- Environment per-app (`.env`, jangan commit): `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL`, `REDIS_URL`, `OBJECT_STORAGE_*`, `ADMIN_TOKEN`/`JWT_SECRET`, credential provider.
- Modul import antar package: `workspace:*` + `exports` ke `src/index.ts`.
- Validasi semua input eksternal (webhook, tool args, request body) dengan zod.
- Webhook signature + request ID + structured logging.

## 9. Roadmap

1. [x] Monorepo + RAG in-memory + admin CRUD skeleton
2. [ ] Multi-tenant foundation (tenants, tenant_users, roles, audit, tenant-scoped service)
3. [ ] Channel account + onboarding nomor existing (BSP pilot; Baileys dev)
4. [ ] Messaging inbound webhook + dedup + outbox outbound
5. [ ] Inbox human CS (handover, human outbound)
6. [ ] Commerce: catalog, cart, checkout, order idempotent
7. [ ] Payment QRIS manual + COD (config per tenant, verifikasi, expiry)
8. [ ] Delivery handoff ke merchant (GoSend di luar flow platform)
9. [ ] Merchant workspace + platform operator dashboard
10. [ ] AI tracing, usage/cost, dan billing records dasar
11. [ ] Production hardening (rate limit, retry, DLQ, observability)
12. [ ] Pilot Soysu + 4–8 merchant UMKM beta
