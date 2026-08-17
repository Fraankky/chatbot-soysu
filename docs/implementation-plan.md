# Master Implementation Plan — Multi-Merchant WhatsApp Commerce Platform

Status: Living document. Sumber kebenaran eksekusi; sinkron dengan `docs/context.md` (PRD) dan `docs/context-arch.md` (arsitektur).

Revisi arah produk dan migrasi WhatsApp dari Baileys ke BSP resmi ada di [`docs/revision-plan.md`](./revision-plan.md).

Dokumen ini memuat rencana productization lengkap: keputusan, fase, kontrak, data model, desain payment, delivery, inbox, dan acceptance criteria.

---

## 1. Ruang Lingkup & Tujuan

Membangun **platform commerce multi-merchant di WhatsApp**:

- Satu codebase, satu deployment awal, banyak tenant. Soysu = merchant pertama / pilot.
- WhatsApp production memakai **satu BSP resmi untuk pilot**. Baileys hanya untuk development/transisi.
- AI agent (Anvia) + RAG + transactional tools per tenant.
- Merchant workspace untuk monitoring, order, stok, knowledge base, inbox, dan handover.
- Pembayaran MVP: **QRIS manual + COD** (tanpa payment gateway).
- Delivery MVP: order handoff ke merchant; merchant mengatur GoSend/kurir di luar flow WhatsApp platform.
- Target komersial awal: layanan terjangkau untuk 4–8 UMKM, dengan setup dibantu dan workflow yang dapat dikustomisasi.

---

## 2. Keputusan yang Dikunci

| Area                 | Keputusan                                          | Alasan                                              |
| -------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Model produk         | SaaS multi-merchant, satu codebase                 | Merchant baru di-onboard, bukan dibuatkan aplikasi  |
| Pilot tenant         | Soysu                                              | Validasi flow + onboarding sebelum merchant lain    |
| Channel production   | BSP resmi (dipilih untuk pilot)                     | Mengurangi beban onboarding/support Meta            |
| Channel dev          | Baileys (dev-only)                                 | Local testing, tanpa SLA production                 |
| Ownership WABA       | Merchant-owned WABA                                | Aset & nomor milik merchant; onboarding terpandu    |
| Payment MVP          | QRIS manual + COD                                  | Tanpa gateway; verifikasi admin dari mutasi         |
| Payment gateway      | Fase berikutnya (Xendit/Midtrans/DOKU)             | Webhook idempotent + signature                      |
| Provider-agnostic    | Boundary stabil via domain model, bukan abstraction prematur | Adapter hanya saat provider kedua dibutuhkan |
| Idempotency          | DB unique constraint + transaction                 | Bukan framework generik                             |
| Outbound messaging   | Outbox queue + delivery status                     | Anti duplikat kirim, status terlihat                |
| Inbox                | Multi-agent human CS + bot pause/resume            | CS menangani kasus ambigu/bulk/komplain              |
| Delivery MVP         | Handoff ke merchant                                | GoSend/kurir di luar flow platform                 |
| Pricing              | Setup fee + monthly platform + usage/pass-through  | Terjangkau untuk UMKM; biaya provider transparan    |
| Customization        | Konfigurasi, workflow, dan custom code             | Scope dan biaya disepakati per merchant             |
| Operating hours      | Order aktif pada jam kerja tenant                  | Di luar jam kerja: FAQ/draft, tidak create sale     |
| Store RAG            | PostgreSQL + pgvector (tenant-aware)               | Isolasi knowledge per merchant                      |
| Debounce             | Redis sliding window 5 dtk                         | Gabungkan burst message                             |
| Notifikasi           | DB `notifications` + polling → SSE                 | Tidak hilang saat admin offline                     |

---

## 3. Arsitektur Target

```
 WhatsApp BSP (pilot) — webhook
                ↓
 Messaging Gateway (apps/gateway-api)
  verify signature → resolve channel_account → resolve tenant
  → dedup (unique message id) → normalize → persist
                ↓
 Redis Debounce Buffer (5s / conversation)
                ↓
 Agent Worker (apps/bot) — Anvia + tools per tenant
   ragSearch | checkStock | cartManager | shippingCalculator | checkout
                ↓
 Commerce Services (packages/commerce + payments + fulfillment)
                ↓
 Outbox Outbound → provider → delivery status
                ↓
 Merchant Workspace (apps/admin-api + admin-web)
  Inbox | Orders | Payments | Delivery | Products | Knowledge
```

Struktur monorepo lengkap ada di `docs/context-arch.md`.

---

## 4. Kontrak (Shared Types)

```ts
interface InboundMessage {
  tenantId: string;
  channelAccountId: string;
  externalMessageId: string; // id unik dari provider
  conversationExternalId: string;
  senderExternalId: string;
  text: string;
  mediaType?: "image" | "document" | null;
  receivedAt: Date;
}

interface OutboundMessage {
  tenantId: string;
  channelAccountId: string;
  conversationId: string;
  text?: string;
  mediaBuffer?: Buffer;
  mediaMime?: string;
  templateName?: string;
  idempotencyKey: string;
}

interface ChannelAdapter {
  receiveEvent(event: unknown): Promise<void>;
  sendText(message: OutboundMessage): Promise<SendResult>;
  sendMedia(message: OutboundMediaMessage): Promise<SendResult>;
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
}
```

```ts
type OrderStatus =
  | "draft"
  | "pending_confirmation"
  | "pending_payment"
  | "processing"
  | "handed_over"
  | "completed"
  | "cancelled";

type PaymentStatus =
  | "not_required" // COD
  | "pending"
  | "proof_submitted"
  | "paid"
  | "rejected"
  | "expired";

type PaymentMethod = "cod" | "qris_manual";

type HandoverStatus = "open" | "assigned" | "waiting_customer" | "resolved";

type DeliveryStatus =
  | "pending_handoff" | "handed_to_merchant" | "completed" | "failed";
```

Order menyimpan **snapshot harga** (unit_price, total). `tenant_id` wajib ada di semua type data bisnis.

---

## 5. Fase Implementasi

### Phase 0 — Validasi Produk & Provider

- [ ] Pilih satu BSP resmi untuk pilot (harga, fitur, dukungan existing number, template, Indonesia).
- [ ] Validasi existing-number migration/coexistence dengan nomor Soysu.
- [ ] Tentukan ownership WABA (rekomendasi: merchant-owned).
- [ ] Tentukan siapa menanggung Meta billing (passthrough ke merchant).
- [ ] Validasi template message & conversation window.
- [ ] Tetapkan SLA internal dan recovery process.
- [ ] Terapkan Meta/BSP fee sebagai pass-through transparan ke merchant.
- [ ] Tetapkan harga UMKM: setup fee, monthly fee, included usage, overage, dan support.
- [ ] Pilot merchant: Soysu di Semarang Atas.

### Phase 1 — Fondasi Multi-Tenant

- [ ] `tenants`, `tenant_users`, roles, merchant settings.
- [ ] Tenant-scoped database services (semua service menerima tenant context).
- [ ] Hapus asumsi ID `default` dan single `ADMIN_TOKEN`.
- [ ] RBAC: `admin`, `operator`, `viewer`.
- [ ] Tenant-scoped RAG, notifications, audit log.
- [ ] Idempotency constraint database.

### Phase 2 — Channel Account & Onboarding

- [ ] `channel_accounts` (provider, external_account_id, phone_number, status).
- [ ] Onboarding state machine: pending → verification_required → migration_required → provisioning → connected → failed → suspended.
- [ ] Flow verifikasi ownership nomor existing.
- [ ] Flow migrasi penuh / coexistence.
- [ ] Webhook registration + signature verification.
- [ ] Disconnect/reconnect handling per channel account.
- [ ] Baileys hanya adapter dev.
- [ ] Platform operator dashboard untuk onboarding, health, support, dan status channel.

### Phase 3 — Messaging & Inbox

- [ ] Inbound webhook normalization + dedup.
- [ ] Outbox outbound + delivery status (queued/sending/sent/delivered/read/failed).
- [ ] Conversation assignment.
- [ ] Human outbound message (role `human`).
- [ ] Bot pause/resume saat handover.
- [ ] Internal notes + SLA + handover events.
- [ ] Business hours, timezone, holiday, cutoff order, dan after-hours message per tenant.
- [ ] Di luar jam kerja: FAQ/draft tetap aktif; checkout/order creation ditolak dengan pesan menunggu jam kerja.

### Phase 4 — Catalog, Cart, Checkout

- [ ] Tenant-specific catalog (product, variant, harga, stok).
- [ ] Cart unique per tenant + conversation; expiry; validasi qty positif.
- [ ] Checkout preview + explicit confirmation.
- [ ] Order creation idempotent (`checkout_request_id` unique).
- [ ] Stock reserve dalam transaction (row lock); release saat expired/cancelled.
- [ ] Snapshot harga order.

### Phase 5 — Payment: QRIS Manual & COD

QRIS manual:

```text
checkout → tampilkan QRIS merchant + total → pending_payment
→ customer kirim bukti → proof_submitted
→ admin cocokkan mutasi → paid | rejected
```

COD:

```text
checkout → konfirmasi merchant/admin → processing
→ handoff ke merchant → delivery di luar platform
```

- [ ] `payment_configs` per tenant (QRIS image/payload, bank, instruksi, active).
- [ ] `payments` state machine + `verified_by`/`verified_at`.
- [ ] Snapshot QRIS per order.
- [ ] Rejection + alasan.
- [ ] Expiry (mis. 30 menit) → release stok + notifikasi.
- [ ] Catat metode COD dan delivery handoff; collection/settlement merchant berada di luar MVP.

### Phase 6 — Delivery Handoff

- [ ] Delivery config per tenant (zona, ongkir, alamat).
- [ ] Delivery handoff status ke merchant.
- [ ] Merchant dapat mencatat reference GoSend/kurir secara manual.
- [ ] Tunda dispatch, tracking otomatis, driver app, dan COD settlement.

### Phase 7 — Merchant Workspace

Menu:

```text
Overview | Inbox | Orders | Payments | Products | Stock
Delivery | Customers | Knowledge Base | WhatsApp Setup
Team & Roles | Merchant Settings | Audit Log
```

- [ ] Inbox multi-agent (assignment, notes, outbound).
- [ ] Order queue + payment verification UI.
- [ ] WhatsApp Setup onboarding wizard.
- [ ] UI states wajib: loading, empty, error, retry, permission denied; konfirmasi dialog untuk mutasi.

### Phase 8 — Production Hardening

- [ ] Rate limit (inbound, outbound, admin).
- [ ] Queue backpressure + retry policy + dead-letter queue.
- [ ] Provider outage handling + runbook.
- [ ] Health checks + graceful shutdown.
- [ ] Secret rotation + credential encryption.
- [ ] Backup + restore test.
- [ ] Tenant isolation test.
- [ ] Audit review + security testing.
- [ ] Structured logging + request/message correlation ID.

### Phase 9 — Pilot & Commercial Launch

- [ ] Pilot Soysu (nomor existing → BSP).
- [ ] 4–8 merchant UMKM beta.
- [ ] Onboarding playbook.
- [ ] Merchant support process.
- [ ] Usage/cost monitoring per tenant.
- [ ] Model billing (biaya tetap + tarif pesan Meta).
- [ ] Usage/cost tracking per tenant (LLM, message, storage, BSP).
- [ ] Platform operator dashboard: tenant, onboarding, provider health, support access, usage, billing.
- [ ] SLA + incident runbook.
- [ ] Migration rollback procedure.

---

## 6. Data Model (Referensi)

### Tenant & Channel

```text
tenants (id, name, slug, status, settings jsonb)
tenant_users (tenant_id, user_id, role, status)
channel_accounts (id, tenant_id, channel, provider,
  external_account_id, phone_number, status, credential_reference)
```

### Messaging

```text
conversations (id, tenant_id, channel_account_id, customer_id, status)
messages (id, tenant_id, conversation_id, role, direction,
  provider_message_id unique per channel_account, text, media, status)
outbound_messages (id, tenant_id, conversation_id, channel_account_id,
  payload, idempotency_key, status)
```

### Commerce & Payment

```text
products (+ tenant_id, variant, price, stock)
carts / cart_items (unique per tenant + conversation, expiry)
orders (tenant_id, conversation_id, status, payment_method,
  payment_status, shipping, total, snapshot)
order_items (snapshot nama, variant, qty, unit_price)
payments (tenant_id, order_id, method, amount, status,
  proof_message_id, proof_file_path, verified_by, verified_at, expired_at)
payment_configs (tenant_id, method, display_name, qris_image/payload,
  bank fields, instructions, active)
```

### Delivery Handoff

```text
delivery_handoffs (tenant_id, order_id, area, address, shipping_cost,
  status, external_reference, notes)
```

### Platform Operations & AI Tracing

```text
platform_users (id, email, role, status)
usage_events (tenant_id, type, quantity, cost_estimate, created_at)
billing_records (tenant_id, period, platform_fee, usage_fee, provider_fee, status)
ai_runs (tenant_id, conversation_id, model, prompt_reference, response,
  tool_calls, retrieval_scores, latency_ms, input_tokens, output_tokens, error)
```

### RAG, Notification, Audit

```text
kb_documents / kb_versions / kb_chunks (+ tenant_id)
notifications (+ tenant_id, type, order_id?, conversation_id?, is_read)
audit_logs (tenant_id, actor, action, entity, data, created_at)
```

---

## 7. Notifikasi (detail)

Tabel `notifications`:

```text
- id, tenant_id
- type (new_order | payment_proof | payment_paid | payment_rejected |
        payment_expired | stock_low | handover_request | order_action_needed |
        delivery_failed | indexing_finished)
- order_id?, conversation_id?
- title, message, is_read, created_at
```

Prioritas:

```text
critical: payment_expired, stock_low, handover_request, delivery_failed
high:     new_order, payment_proof, payment_paid, payment_rejected
normal:   order status update, indexing_finished
```

MVP memakai polling; SSE setelah stabil.

---

## 8. Idempotency (detail)

- Inbound message: `unique(channel_account_id, provider_message_id)` — dedup event webhook.
- Order creation: `unique(tenant_id, conversation_id, checkout_request_id)` — cegah double order saat retry/duplicate konfirmasi.
- Payment verification: hanya transisi dari `pending`/`proof_submitted` ke `paid` sekali.
- Outbound send: `idempotency_key` — retry worker tidak mengirim dua kali.
- Semua dalam satu database transaction.

---

## 9. Acceptance Criteria (checklist)

- [ ] Merchant baru bisa di-onboard tanpa membuat aplikasi baru (via `tenants` + `channel_accounts`).
- [ ] Data antar tenant terisolasi (service selalu memakai tenant context; tidak ada endpoint lintas tenant).
- [ ] Nomor existing bisa dihubungkan lewat flow verifikasi + migration/coexistence resmi.
- [ ] Webhook inbound terverifikasi signature; duplicate event tidak menggandakan message.
- [ ] Outbound lewat outbox; status delivery terlihat; retry tidak mengirim duplikat.
- [ ] Burst 10 pesan/3 dtk → satu agent run; response tidak terduplikasi.
- [ ] Checkout hanya setelah konfirmasi eksplisit; duplicate request tidak membuat duplicate order.
- [ ] QRIS manual: bukti upload → queue verifikasi → mark paid/reject; tercatat verified_by/at.
- [ ] COD: konfirmasi merchant → processing → handoff; delivery/collection berada di luar platform MVP.
- [ ] Payment expired melepas reservasi stok + notifikasi.
- [ ] Handover: bot berhenti membalas; human bisa kirim pesan keluar; resume setelah resolved.
- [ ] Delivery handoff ke merchant tercatat; GoSend/kurir tidak perlu terintegrasi pada MVP.
- [ ] Di luar jam kerja bot tidak membuat order aktif, tetapi memberi FAQ/draft dan pesan estimasi response.
- [ ] AI trace tersedia untuk setiap run: model, context reference, tools, retrieval score, response, latency, token usage, error.
- [ ] Platform operator dapat memantau 4–8 tenant tanpa mencampur akses tenant.
- [ ] Stock & harga selalu dari database tenant (bukan RAG/tebakan).
- [ ] Endpoint mutation admin butuh auth + RBAC; semua body zod-validated; audit log terisi.
- [ ] Recovery test: Postgres restart, Redis restart, bot restart, provider disconnect.
