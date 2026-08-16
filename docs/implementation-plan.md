# Master Implementation Plan — soysu.id Agentic RAG WhatsApp Bot

Status: Living document. Sumber kebenaran eksekusi; sinkron dengan `docs/context.md` (PRD) dan `docs/context-arch.md` (arsitektur).

Revisi arah pairing WhatsApp, dual-channel gateway, memory, dan orchestration ada di [`docs/revision-plan.md`](./revision-plan.md).

Dokumen ini memuat rencana eksekusi lengkap: keputusan MVP, arsitektur, fase implementasi, kontrak, analytics dashboard, notifikasi, dan desain pembayaran.

---

## 1. Ruang Lingkup & Tujuan

Membangun **Agentic RAG Customer Service & Automated Sales Bot** untuk `soysu.id`:

- Bot WhatsApp (Baileys) + Anvia agent dengan RAG dan transactional tools.
- Admin dashboard untuk monitoring, order processing, stok, knowledge base, dan human handover.
- Pembayaran MVP: **COD + transfer bank / QRIS manual** (tanpa payment gateway).

---

## 2. Keputusan yang Dikunci (MVP)

| Area             | Keputusan                           | Alasan                                                             |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Channel          | WhatsApp dahulu (Baileys)           | Telegram ditunda sampai vertical slice selesai                     |
| Admin FE         | Vite + React + TS                   | Sudah ada, cukup untuk SPA dashboard; Next.js hanya jika SSR wajib |
| Admin BE         | Hono                                | Ringan, TS-first                                                   |
| ORM              | Drizzle                             | SQL-first, pgvector-friendly                                       |
| LLM              | OpenAI via Anvia (provider pertama) | Multi-provider fallback setelah baseline stabil                    |
| Payment MVP      | COD + bank transfer/QRIS manual     | Tanpa gateway; verifikasi admin                                    |
| Payment phase 2  | Hosted payment link + webhook       | Xendit / Midtrans                                                  |
| Store RAG        | PostgreSQL + pgvector               | Migration target dari in-memory                                    |
| Debounce         | Redis sliding window 5 dtk          | Solusi P95 di bawah                                                |
| Notifikasi order | DB `notifications` + polling → SSE  | Tidak hilang saat admin offline                                    |

### Resolusi kontradiksi debounce vs P95

PRD lama: "P95 < 4 dtk termasuk buffer debounce 5 dtk" — mustahil jika bot selalu menunggu 5 dtk.

Keputusan: **kirim acknowledgement instan + proses burst asynchronous.**

- Pesan pertama memicu balasan singkat ("Oke Kak, sebentar ya~") tanpa menunggu debounce penuh.
- Burst dikumpulkan di Redis selama 5 dtk, lalu diproses menjadi satu agent run.
- P95 diukur pada **waktu agent run setelah debounce**, bukan termasuk window debounce.

### Perbaikan wajib sebelum build (foundation)

`pnpm-workspace.yaml` saat ini invalid:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

Harus diganti dengan boolean eksplisit atau pakai `onlyBuiltDependencies` yang sudah benar.

---

## 3. Arsitektur Target

```
                      ┌────────────────────────────┐
                      │      WhatsApp (Baileys)    │
                      └─────────────┬──────────────┘
                                    │ raw messages
                                    ▼
                      ┌────────────────────────────┐
                      │  Gateway (apps/bot)        │
                      │  normalize + dedup         │
                      │  + idempotency             │
                      └─────────────┬──────────────┘
                                    ▼
                      ┌────────────────────────────┐
                      │  Redis Debounce Buffer     │
                      │  (5s sliding window / conv)│
                      └─────────────┬──────────────┘
                                    ▼
                      ┌────────────────────────────┐
                      │  Anvia Agent Orchestration │
                      │  ragSearch | checkStock    │
                      │  cartManager | checkout    │
                      │  shippingCalculator        │
                      └───────┬──────────┬─────────┘
                              │          │
                              ▼          ▼
              ┌──────────────────┐  ┌──────────────────┐
              │  PostgreSQL      │  │  Outbound Queue  │
              │  + pgvector      │  │  typing + delay  │
              │  + Redis         │  └────────┬─────────┘
              └──────────────────┘           ▼
                                   kirim balasan + receipt

  Admin API (apps/admin-api) ──► PostgreSQL ──► Notifikasi ──► Admin Web
```

### Struktur monorepo (target setelah fase berjalan)

```text
soysu/
├── apps/
│   ├── bot/                      # Agent runtime + gateway
│   │   └── src/
│   │       ├── gateway/          # baileys.ts, normalize.ts, debounce.ts, outbound.ts
│   │       ├── anvia/            # runtime.ts, state.ts, tools/*, nodes/*
│   │       ├── llm/              # (phase 10) router + providers
│   │       ├── rag.ts
│   │       └── index.ts
│   ├── admin-api/                # Hono REST + webhook payment (phase 2)
│   └── admin-web/                # Vite + React dashboard
├── packages/
│   ├── database/                 # Drizzle schema, migrations, repositories, services
│   ├── rag/                      # chunker, embedder, pgvector retriever
│   └── shared/                   # types + constants (OrderStatus, PaymentMethod, …)
├── docker-compose.yml            # postgres+pgvector, redis
├── docs/                         # PRD, arsitektur, plan ini
├── AGENTS.md
└── moon.yml
```

---

## 4. Kontrak (Shared Types)

Didefinisikan di `packages/shared` sejak awal.

```ts
interface InboundMessage {
  channel: "whatsapp" | "telegram";
  externalMessageId: string; // id unik dari provider
  conversationId: string; // "wa:628xxx@s.whatsapp.net"
  senderId: string;
  text: string;
  mediaType?: "image" | "document" | null; // untuk bukti transfer
  receivedAt: Date;
}

interface OutboundMessage {
  conversationId: string;
  text: string;
  mediaBuffer?: Buffer; // receipt / gambar
  mediaMime?: string;
}

interface ChannelAdapter {
  connect(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  setTyping(conversationId: string, typing: boolean): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}
```

```ts
type OrderStatus =
  | "draft"
  | "pending_confirmation" // menunggu konfirmasi admin/customer
  | "processing"
  | "ready_to_deliver"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

type PaymentStatus =
  | "not_required" // COD
  | "pending" // menunggu transfer / QRIS
  | "paid"
  | "failed"
  | "expired";

type PaymentMethod = "cod" | "bank_transfer" | "qris_manual";

type HandoverStatus = "open" | "assigned" | "waiting_customer" | "resolved";
```

Order menyimpan **snapshot harga** (unit_price, total) agar perubahan harga produk tidak mengubah order lama.

---

## 5. Fase Implementasi

### Phase 0 — Foundation & Kontrak

- [ ] Perbaiki `pnpm-workspace.yaml` (allowBuilds invalid).
- [ ] Tambah `packages/database` (Drizzle + client).
- [ ] Tambah `docker-compose.yml` (postgres:16-pgvector, redis:7-alpine).
- [ ] Definisikan shared types (kontrak di atas).
- [ ] `.env.example` terpusat + validasi env wajib saat boot.
- [ ] `pnpm moon run :format :lint :typecheck` hijau.

### Phase 1 — Persistent Database Core

Schema Drizzle minimum:

- `customers`, `conversations`, `messages`
- `wa_auth_sessions`
- `products`, `product_prices`, `stock_movements`, `stock_reservations`
- `carts`, `cart_items`
- `orders`, `order_items`, `payments`
- `notifications`
- `handovers`, `handover_events`
- `kb_documents`, `kb_document_versions`, `kb_parents`, `kb_child_chunks`, `kb_ingestion_jobs`

Aturan:

- Unique `messages(provider_message_id)` → idempotency.
- Unique `conversations(channel, external_id)`.
- Stok dikurangi dalam transaksi dengan row lock (reservation).
- Semua perubahan harga/stok masuk `stock_movements` / audit.
- Migration repeatable + rollback strategy tercatat.

### Phase 2 — Shared Repository & Service Layer

```text
packages/database/src/
├── client.ts
├── redis.ts
├── repositories/*          # products, stock, carts, orders, conversations, knowledge, notifications
├── services/
│   ├── checkout.ts         # transaksi order + reservation
│   ├── stock.ts            # reserve/release/adjust dengan lock
│   ├── payment.ts          # MVP: mark paid, expire, bukti transfer
│   └── handover.ts
└── index.ts
```

- Tool bot dan admin API memakai **service yang sama**. Tidak boleh ada implementasi stok kedua.
- `checkStock` → baca repository, bukan `SEED_PRODUCTS`.

### Phase 3 — Durable RAG

Perbaikan terhadap RAG in-memory saat ini:

- `parentId` harus menunjuk parent document sungguhan (sekarang hanya id acak per grup).
- Simpan dokumen parent di `kb_parents`.
- Simpan `embedding_model` + `embedding_dimensions` per version.
- Ganti token overlap dengan sparse search berbasis Postgres (pg_trgm) atau normalisasi token sendiri — **bukan** `to_tsvector('english', ...)` (tidak cocok untuk bahasa Indonesia).
- Ingestion di background; version aktif hanya diaktifkan setelah indexing sukses.
- Retrieval: dense + sparse → weighted merge (`0.7 * dense + 0.3 * sparse`) → parent expansion → confidence threshold → konteks untuk agent.
- Embedding dimulai **lazy** (saat ingest/retrieve), bukan saat bot boot, supaya startup bot tidak menunggu API call.

### Phase 4 — WhatsApp Gateway

`apps/bot/src/gateway/`:

- `baileys.ts`: Baileys socket, QR/pairing, reconnect backoff, graceful shutdown.
- Session persistence ke PostgreSQL (`wa_auth_sessions`).
- `normalize.ts`: map event Baileys → `InboundMessage`.
- Filter: abaikan pesan sendiri, group/broadcast sesuai aturan bisnis.
- `idempotency.ts`: dedup berdasarkan `provider_message_id`.

### Phase 5 — Redis Debounce & Processing

Flow:

```text
inbound → persist ke Postgres → append Redis buffer → reset timer 5s
  → claim buffer atomic → create agent run → process combined prompt
```

Redis key:

```text
conversation:{id}:debounce
conversation:{id}:processing-lock
```

Wajib: TTL, max message count, max payload, atomic claim, lock single-flight, recovery saat worker mati, idempotency key, dead-letter.

### Phase 6 — Agent Runtime & Transactional Tools

Tools Anvia (`createTool` + zod):

- `ragSearch` — baca knowledge base, kembalikan konteks + score, jangan jawab langsung.
- `checkStock` — baca stock service, **tanpa side effect**.
- `cartManager` — add/remove/update qty/set sweetness, validasi produk & stok.
- `shippingCalculator` — validasi area (Sleman/Bantul/Kota Yogyakarta), estimasi ongkir.
- `checkout` — validasi cart, reserve stock, buat order, simpan snapshot harga, **hanya setelah konfirmasi eksplisit**.

Side-effect policy:

- Read-only tools boleh retry terbatas.
- Tool transactional tidak boleh di-retry buta; semua side effect idempotent (idempotency key).

### Phase 7 — Checkout, Payment MVP & Receipt

#### Alur order + pembayaran (MVP)

```text
Cart ready
  → shipping validated
  → order summary ditampilkan
  → customer pilih metode: COD | bank_transfer | qris_manual
  → konfirmasi eksplisit customer
```

**COD:**

```text
order_status = pending_confirmation, payment_status = not_required
  → admin konfirmasi di Orders > New
  → processing → out_for_delivery → completed
```

**bank_transfer / qris_manual:**

```text
order_status = pending_confirmation, payment_status = pending
  → bot kirim instruksi pembayaran (nomor rekening / QRIS statis)
  → customer upload bukti (image via WA)
  → bukti disimpan (payments.proof_message_id, file di storage)
  → admin verifikasi di Payments queue → "Mark as Paid"
  → payment_status = paid, order_status = processing
  → expired (mis. 30 menit) → payment_status = expired → release stock reservation
```

#### Stock reservation

- Saat checkout: reserve stok dalam transaksi dengan row lock.
- Order masih `pending`: stok **direservasi**, bukan dikurangi permanen.
- Pembayaran paid / order diproses → reservation dikonversi ke pengurangan stok.
- Order expired/cancelled → release reservation.

#### Receipt

- Mulai dari HTML/PDF deterministik (simpan untuk cetak ulang), lalu kirim sebagai file.
- Isi: logo Soysu, order id, tanggal, item + sweetness, ongkir, total, metode bayar, status pembayaran.

#### Notifikasi order

Event → insert `notifications` → dashboard menampilkan badge/toast:

- order baru (PENDING_CONFIRMATION / PENDING_PAYMENT)
- customer upload bukti pembayaran
- payment paid / expired
- stok kritis
- handover request
- order butuh konfirmasi admin

### Phase 8 — Admin API & Security

Endpoint:

```text
Dashboard      GET  /api/dashboard/summary
               GET  /api/analytics/conversations?from&to   (memori)
               GET  /api/analytics/knowledge?from&to       (knowledge)
Products       GET/POST /api/products
               PATCH/DELETE /api/products/:id
Stock          GET  /api/stock
               POST /api/stock/adjustments
Orders         GET  /api/orders
               GET  /api/orders/:id
               PATCH /api/orders/:id/status
               POST /api/orders/:id/receipt
Payments       GET  /api/payments
               POST /api/payments/:id/mark-paid
Notifications  GET  /api/notifications
               POST /api/notifications/:id/read
Knowledge      GET/POST /api/knowledge
               PATCH/DELETE /api/knowledge/:id
               POST /api/knowledge/:id/reindex
Handover       GET  /api/handovers
               POST /api/handovers/:id/assign
               POST /api/handovers/:id/resolve
```

Security:

- Auth sebelum endpoint mutation (session/JWT).
- RBAC: `admin`, `operator`, `viewer`.
- Validasi semua body/query dengan zod.
- Audit log untuk: price, stock adjustment, order status, knowledge, handover, payment verify.
- CORS tidak wildcard di production; request ID + structured logging.

### Phase 9 — Admin UI (Vite + React)

Menu:

```text
Dashboard
├── Overview          (angka kunci + ringkasan)
├── Orders            (queue proses + filter status)
├── Payments          (verifikasi bukti transfer/QRIS)
├── Notifications     (badge + daftar)
├── Human Handover
├── Products & Stock
├── Knowledge Base / RAG
├── Conversations / Customers
└── Settings
```

UI states wajib: loading, empty, error, retry, permission denied; konfirmasi dialog untuk mutasi.

### Phase 10 — Multi-provider LLM Router (setelah baseline stabil)

Urutan provider:

```text
Primary:   OpenAI (Anvia)
Secondary: Gemini (setelah tool calling tervalidasi)
Tertiary:  OpenRouter (setelah capability mapping)
Optional:  GLM/ZAI (setelah API contract tervalidasi)
```

Aturan:

- Round-robin hanya antar API key provider yang sama; cooldown setelah 429.
- Fallback inter-provider hanya untuk: timeout, 429, 5xx, unavailable.
- Jangan fallback pada: invalid key, invalid request, schema tool tak kompatibel, atau request yang sudah punya side effect.
- Circuit breaker: closed → open → half-open.
- Capability matrix per provider: tool calling, structured output, context limit, streaming, error format.

### Phase 11 — Human Handover

State machine: `open → assigned → waiting_customer → resolved`.

- Bot pause saat handover aktif (`bot_paused = true`).
- Trigger: low retrieval confidence, frustrasi, bulk order, tool failure berulang, permintaan eksplisit.
- Ownership dicatat di event log; bot resume setelah resolved.

### Phase 12 — Testing, Evaluation & Observability

Unit test: chunker, scoring, stock reservation, cart, checkout, payment expiry, provider error classification, debounce.

Integration: migration, pgvector retrieval, Redis debounce, admin API + DB, bot tool + DB, Baileys normalize.

Scenario: FAQ, cek stok, ganti sweetness, konfirmasi order, burst message, request human, provider 429/timeout, duplicate message, Redis restart, DB down, payment expired, bukti transfer diverifikasi.

RAG eval: dataset (question, expected_document, expected_facts, must_not_claim); metric recall@k, faithfulness, no-answer accuracy.

Observability: inbound latency, debounce duration, agent run duration, token usage, tool duration, retrieval score, fallback count, handover count, order conversion, duplicate count, provider error rate.

### Phase 13 — Docker & Production Readiness

`docker-compose.yml`: postgres, redis, admin-api, admin-web, bot (worker ingestion terpisah bila embedding berat).

Concern: backup Postgres, persistence Redis, secret rotation, health check, graceful shutdown, migration execution, log retention, resource limits, WhatsApp session backup, runbook outage provider.

---

## 6. Analytics Dashboard (Graph)

### Prinsip

- **Graph dinamis hanya untuk dua domain: memori & knowledge.** Sisanya cukup kartu angka / tabel.
- Data disajikan dari endpoint agregasi Admin API (query Postgres, bukan realtime streaming).

### Memori (conversations & messages) — dynamic

- Inbound messages per hari (7/30 hari).
- Active conversations per hari.
- Bot vs human messages per hari.
- Rata-rata durasi agent run / response time.
- Handover rate per hari.

Data model (minimal):

```text
conversations (id, channel, external_id, status, created_at, last_message_at)
messages     (id, conversation_id, role[user|bot|human], text, created_at)
```

Endpoint: `GET /api/analytics/conversations?from&to` → time-series agregasi.

### Knowledge (RAG usage) — dynamic

- Jumlah query retrieval per hari.
- Top queries (grouping teks serupa).
- Distribusi retrieval confidence / score.
- No-answer rate (query tanpa konteks cukup).
- Status knowledge base: jumlah dokumen per kategori, versi aktif, index pending/gagal.
- Latency retrieval rata-rata.

Data model (minimal):

```text
rag_events (id, conversation_id, query, top_score, no_answer, latency_ms, created_at)
kb_documents (id, title, category, status, active_version_id)
kb_ingestion_jobs (id, document_id, status, chunks_count, error, created_at)
```

Endpoint: `GET /api/analytics/knowledge?from&to`.

### Statis/sederhana (bukan graph dinamis)

- Kartu angka: order hari ini, revenue, stok kritis, payment pending.
- Tabel produk, order, payment queue.

### Notifikasi real-time

- MVP: polling `GET /api/notifications` tiap 10 dtk.
- Setelah stabil: SSE (`GET /api/notifications/stream`) untuk update instan tanpa WebSocket.

---

## 7. Desain Pembayaran (detail)

### Keputusan

- **MVP: COD + bank transfer/QRIS manual. Tanpa payment gateway.**
- Payment gateway (hosted payment link + webhook) = fase berikutnya, opsional.

### Tabel `payments`

```text
id, order_id, method, amount,
proof_message_id,        -- id pesan WA bukti transfer
proof_file_path,         -- path media bukti (storage lokal/S3 nanti)
status,                  -- pending | paid | failed | expired | not_required
verified_by, verified_at,  -- admin yang menandai paid
expired_at, created_at
```

### Alur verifikasi manual (admin)

```text
Customer upload bukti → payments.proof_message_id terisi
  → notification "Bukti pembayaran masuk"
  → admin buka Payments queue → lihat bukti
  → verifikasi nominal via mutasi rekening (jangan percaya screenshot)
  → "Mark as Paid" → payment_status=paid → order processing
```

Catatan keamanan:

- Jangan mempercayai nominal dari screenshot; verifikasi dari dashboard merchant/mutasi.
- Log `verified_by` + `verified_at` untuk audit.
- Expiry tetap berjalan; bukti yang telat diproses sesuai kebijakan (manual oleh admin).

### Expiry & stok

```text
PENDING_PAYMENT → (30 menit) → EXPIRED
  → release stock reservation
  → notifikasi customer + admin
```

### Payment gateway (fase berikutnya — catatan)

- Pilihan kandidat: Xendit (payment link/invoice) atau Midtrans Snap.
- Pola: backend buat invoice → customer dapat URL via WA → bayar → webhook → verifikasi signature → `paid`.
- Tidak pernah menyimpan kartu/CVV; simpan hanya `provider_payment_id`, `checkout_url`, `raw_status`.
- Webhook harus idempotent.

---

## 8. Notifikasi (detail)

Tabel:

```text
notifications
- id
- type            (new_order | payment_proof | payment_paid | payment_expired | stock_low | handover_request | order_action_needed | delivery_failed | indexing_finished)
- order_id?
- conversation_id?
- title, message
- is_read
- created_at
```

Prioritas:

```text
critical: payment_expired, stock_low, handover_request, delivery_failed
high:     new_order, payment_proof, payment_paid
normal:   order status update, indexing_finished
```

---

## 9. MVP Scope (yang dibangun pertama)

1. [x] Perbaiki `pnpm-workspace.yaml` + tambah `packages/database`.
2. [x] Docker Compose: PostgreSQL+pgvector, Redis.
3. [x] Drizzle schema + migrations + repositories/services.
4. [x] Migrasi `checkStock` dari seed ke DB; cart & order transaction.
5. [x] RAG persistent (pgvector) + lazy embed.
6. [x] Baileys gateway + Redis debounce + typing/outbound.
7. [x] Anvia agent: `ragSearch`, `checkStock`, `cartManager`, `shippingCalculator`, `checkout`.
8. [x] Payment MVP: COD + transfer/QRIS manual + verifikasi admin.
9. [x] Admin API + UI: Overview, Orders, Payments, Notifications, Products/Stock, Knowledge.
10. [x] Graph dinamis: memori & knowledge.
11. [x] Basic human handover.
12. [x] Unit/integration test utama.

**Ditunda:** Telegram, GLM/ZAI, multi-provider fallback kompleks, reranker Cohere, receipt image, migrasi Next.js, payment gateway, analytics lanjutan.

---

## 10. Acceptance Criteria (checklist)

- [ ] `pnpm install` bersih tanpa config invalid.
- [ ] `pnpm moon run :format :lint :typecheck` hijau.
- [ ] Migration jalan dari DB kosong; rollback strategy tercatat.
- [ ] Perubahan stok di admin langsung terlihat di tool bot (DB bersama).
- [ ] Burst 10 pesan/3 dtk → satu agent run; duplicate event tidak menggandakan response.
- [ ] Checkout hanya setelah konfirmasi eksplisit; duplicate request tidak membuat duplicate order.
- [ ] COD: order masuk Orders queue + notifikasi; admin konfirmasi → processing.
- [ ] Transfer/QRIS: bukti upload → Payments queue → Mark as Paid → paid + processing.
- [ ] Expired payment melepas stock reservation + notifikasi.
- [ ] Receipt deterministik, bisa dicetak ulang dari admin.
- [ ] Graph memori & knowledge menampilkan data agregasi; notifikasi muncul via polling (→ SSE).
- [ ] Handover: bot berhenti membalas saat handover aktif, resume setelah resolved.
- [ ] Endpoint mutation admin tidak bisa diakses tanpa auth; semua body zod-validated; audit log terisi.
- [ ] Recovery test: Postgres restart, Redis restart, bot restart, Baileys reconnect.
