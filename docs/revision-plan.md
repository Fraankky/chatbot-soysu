# Revision Plan: WhatsApp Pairing, Memory, and Agentic Gateway

Status: Proposed direction. Dokumen ini merevisi `docs/implementation-plan.md` berdasarkan kebutuhan hackathon dan alur pairing WhatsApp.

## 1. Arah Utama

Target MVP direvisi menjadi:

1. WhatsApp sebagai channel utama dengan pairing QR dari Admin Dashboard.
2. Telegram memakai adapter yang sama setelah WhatsApp stabil.
3. Redis untuk short-term session dan burst debounce.
4. PostgreSQL untuk customer profile, cart archive, order, message, dan knowledge base.
5. Anvia tetap menjadi agent framework utama.
6. OpenAI menjadi provider pertama; multi-provider dibuat setelah flow dasar stabil.
7. Pembayaran tetap COD + transfer/QRIS manual.

Jangan membangun dua agent framework. Google Agents CLI/ADK tetap opsional dan tidak dimasukkan ke runtime utama karena stack saat ini TypeScript + Anvia.

## 2. WhatsApp Pairing dari Dashboard

### 2.1 User Experience

Admin Dashboard memiliki halaman `/whatsapp`:

```text
WhatsApp Connection

[ QR code ]

WhatsApp on the cafe phone → Settings
Linked devices → Link a device
Point it at this code

Status: Not paired / Connecting / Connected
Last message: ...

[Unpair]
```

Setelah paired:

- QR disembunyikan.
- Status menjadi `Connected`.
- Tampilkan nomor/device jika tersedia.
- Tampilkan waktu koneksi terakhir.
- Tampilkan pesan error/reconnect terakhir.

Saat admin menekan `Unpair`:

1. Admin API membuat command `whatsapp.unpair`.
2. Bot memutus socket.
3. Credential tersimpan dihapus.
4. QR baru dibuat.
5. Status kembali `not_paired`.

### 2.2 Arsitektur Pairing

Jangan expose internal service sebagai `http://whatsapp:8787` dari browser. Browser hanya berbicara ke `admin-api`.

```text
Admin Web
  ↓ HTTP / polling atau SSE
Admin API
  ↓ Redis command/status
Bot Engine + Baileys
  ↓ WhatsApp WebSocket
WhatsApp
```

### 2.3 State Storage

```text
id
status                 -- not_paired | qr_ready | connecting | connected | disconnected
phone_number
device_name
last_qr_at
connected_at
last_seen_at
last_error
updated_at
```

`wa_auth_state`:

```text
connection_id
kind                   -- creds | key
key_name
value                  -- encrypted JSON/byte representation
updated_at
```

Credential dan signal keys harus disimpan terenkripsi. Jangan memasukkan credential ke response Admin API.

#### Redis

```text
whatsapp:qr:{connectionId}             TTL 120s
whatsapp:command:{connectionId}        queue
whatsapp:status:{connectionId}         short-lived status
```

QR hanya disimpan sementara. QR Baileys berupa string; Admin Web yang merendernya menjadi gambar QR.

### 2.4 API

```text
GET  /api/whatsapp/status
GET  /api/whatsapp/qr
POST /api/whatsapp/connect
POST /api/whatsapp/unpair
GET  /api/whatsapp/events              -- optional SSE setelah polling stabil
```

MVP menggunakan polling 2-5 detik. SSE tidak diperlukan untuk pairing awal.

Response status minimal:

```json
{
  "status": "qr_ready",
  "qr": "...",
  "lastError": null,
  "updatedAt": "..."
}
```

### 2.5 Gateway Lifecycle

```text
start bot
  ↓
load auth state from PostgreSQL
  ↓
connect Baileys
  ├── qr event       → persist status + Redis QR
  ├── connection open → status connected
  ├── connection close 401 → status not_paired
  ├── connection close other → reconnect with backoff
  └── creds.update    → persist encrypted state
```

`useMultiFileAuthState` yang sekarang dipakai hanya sebagai development fallback. Untuk target pairing dashboard, migrasikan ke database-backed auth state sebelum demo production.

## 3. Dual-Channel Messaging Gateway

Buat interface internal yang sama untuk WhatsApp dan Telegram:

```ts
interface ChannelAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  setTyping(conversationId: string, typing: boolean): Promise<void>;
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
```

Adapter:

```text
apps/bot/src/gateway/
├── types.ts
├── baileys.ts
├── telegram.ts
├── normalize.ts
├── debounce.ts
└── outbound.ts
```

WhatsApp dan Telegram menghasilkan `InboundMessage` yang sama. Business logic tidak boleh mengetahui detail JID atau Telegram update object.

### Urutan implementasi

1. WhatsApp pairing + inbound/outbound.
2. Redis debounce.
3. Agent processing.
4. Telegram adapter.

Jangan mengerjakan dua gateway sekaligus sebelum WhatsApp vertical slice lulus.

## 4. Dual-Layer Memory

### 4.1 Short-Term Session Memory

Redis key:

```text
session:{channel}:{conversationId}
```

TTL: **2 jam sejak interaksi terakhir**.

Value minimal:

```json
{
  "conversationId": "wa:628xxx@s.whatsapp.net",
  "currentCart": [
    {
      "productId": "soysu-002",
      "qty": 2,
      "sweetnessLevel": "Less Sugar"
    }
  ],
  "conversationStage": "cart_building",
  "lastIntent": "cart_building",
  "updatedAt": "..."
}
```

Aturan:

- Pesan dalam 2 jam melanjutkan session.
- Setelah 2 jam, `currentCart` dihapus/diarsipkan.
- Customer profile tetap ada.
- Cart abandoned diarsipkan setelah 24 jam melalui scheduled cleanup.
- Cart/order durable tetap PostgreSQL; Redis hanya accelerator/session state.

### 4.2 Persistent Customer Profile

Tambahkan tabel `customer_preferences`:

```text
customer_id
preferred_sweetness
favorite_flavor
default_delivery_area
default_address
source                  -- explicit | inferred
confidence
updated_at
```

Aturan keamanan:

- Preferensi hanya disimpan jika eksplisit atau confidence cukup.
- Jangan menyimpan data sensitif yang tidak diperlukan.
- Customer dapat meminta penghapusan profil.

### 4.3 Memory Retrieval

Sebelum agent run:

```text
Inbound burst
  ↓
load session Redis
  ↓
load customer profile PostgreSQL
  ↓
build agent context
  ↓
run Anvia
```

Setelah agent run:

```text
update session TTL
persist cart/order/message
update explicit preference if applicable
```

## 5. Anvia Orchestration

Target logic:

```text
Inbound message
  ↓
Debounce + memory context
  ↓
Intent Router
  ├── FAQ / product explanation → Hybrid RAG
  ├── stock / cart / shipping   → Transactional tools
  ├── checkout                  → Order + payment flow
  └── frustration / bulk order  → Human handover
  ↓
Response formatter
  ↓
Typing delay + outbound adapter
```

### Catatan API Anvia

Jangan mengklaim implementasi sebagai DAG/multi-node sebelum API Anvia yang tersedia mendukung node graph tersebut. Untuk MVP, gunakan satu `AgentBuilder` dengan tools dan explicit routing instruction. Tambahkan node terpisah hanya jika:

- API Anvia sudah diverifikasi;
- setiap node memiliki test;
- routing memberi manfaat nyata.

Ini mencegah abstraksi DAG palsu yang hanya menambah file.

## 6. Intent Router dan Provider Strategy

### MVP

- OpenAI via Anvia.
- Satu model router/agent.
- Intent dapat berupa structured output atau tool selection Anvia.
- Tidak ada fallback provider dahulu.

### Fase berikutnya

Provider capability matrix:

```text
provider
model
tool_calling
structured_output
streaming
max_context
error_classification
```

Provider target:

1. Gemini.
2. OpenRouter.
3. GLM/ZAI jika tool calling dan error contract kompatibel.

Round-robin key picker hanya untuk key provider yang sama. Fallback tidak boleh mengulang tool transactional secara buta.

## 7. RAG Revision

### Retrieval

```text
query rewrite
  ↓
dense pgvector HNSW
  ↓
sparse Indonesian-aware search
  ↓
score = 0.7 dense + 0.3 sparse
  ↓
parent expansion
  ↓
Cohere reranker (optional, after baseline)
  ↓
top 3 context + confidence threshold
```

### Ingestion

```text
Admin upload
  ↓
document version = indexing
  ↓
parent chunks ~400 tokens
  ↓
child chunks ~100 tokens
  ↓
embedding
  ↓
vector + metadata persist
  ↓
only then mark version active
```

Jika indexing gagal, versi aktif lama tetap digunakan. Ini adalah error handling untuk mencegah data knowledge rusak, bukan compatibility fallback.

### Admin upload

MVP menerima `.md`/`.txt` dahulu. PDF parsing ditambahkan setelah alur text stabil. Jangan menggabungkan upload, PDF OCR, chunking, embedding, dan reranking dalam satu fase.

## 8. Transactional Tools

### `checkStock`

- Query PostgreSQL langsung.
- Tidak menggunakan RAG.
- Tidak boleh mengarang harga/stok.

### `cartManager`

- Add/remove/update item.
- Validasi sweetness.
- Session 2 jam di Redis.
- Durable cart di PostgreSQL.

### `shippingCalculator`

Area MVP:

- Depok/Sleman.
- Bantul.
- Kota Yogyakarta.

Output harus menyebutkan area valid/invalid dan biaya ongkir.

### `checkout`

- Wajib explicit confirmation.
- Reserve stock transactionally.
- Simpan snapshot harga.
- COD → `payment_status = not_required`.
- Transfer/QRIS → `payment_status = pending`.

### `generateReceipt`

Tahap MVP:

1. Text receipt deterministik.
2. HTML/PDF dari template.
3. Image receipt hanya jika benar-benar diperlukan.

Receipt harus bisa dicetak ulang dari Admin API.

## 9. Admin Dashboard Revision

### Menu

```text
Dashboard
├── WhatsApp Connection
├── Orders
├── Payments
├── Notifications
├── Conversations / Handover
├── Products & Stock
└── Knowledge Base
```

### Dynamic graphs

Graph hanya dinamis untuk:

#### Memory

- inbound messages per hari;
- active sessions;
- bot vs human messages;
- handover rate;
- response latency.

#### Knowledge

- RAG query per hari;
- no-answer rate;
- retrieval confidence;
- top knowledge documents;
- indexing success/failure.

Order, revenue, dan stock cukup menggunakan cards/tables pada MVP.

### Notifications

Order baru otomatis:

```text
checkout
  ↓
create order + notification row
  ↓
Orders queue: pending_confirmation / pending_payment
  ↓
notification badge + polling dashboard
```

Event penting:

- order baru;
- bukti transfer masuk;
- payment paid/expired;
- stok kritis;
- handover request;
- WhatsApp disconnected.

MVP memakai polling. SSE hanya setelah data dan event sudah stabil.

### Admin framework

Repo saat ini memakai Vite + React. Jangan migrasi ke Next.js 14 + Shadcn hanya karena target dokumen menyebutkannya, kecuali requirement hackathon mengharuskannya. Migrasi framework bukan fitur bisnis dan tidak membantu pairing/RAG/order flow.

## 10. Execution Order Revision

### Milestone A — Pairing vertical slice

- [ ] PostgreSQL-backed Baileys auth state.
- [ ] `wa_connections` status.
- [ ] QR event → Redis TTL → Admin API.
- [ ] Dashboard `/whatsapp` menampilkan QR/status.
- [ ] Unpair menghapus credential dan membuat QR baru.

### Milestone B — WhatsApp message loop

- [ ] Normalize inbound WhatsApp.
- [ ] Persist message.
- [ ] Redis debounce 5 detik.
- [ ] Generate reply dengan Anvia.
- [ ] Typing indicator + outbound.
- [ ] Bot pause saat handover.

### Milestone C — Memory

- [ ] Redis session TTL 2 jam.
- [ ] Cart archive setelah 24 jam.
- [ ] Customer profile/preferences.
- [ ] Re-engagement context.

### Milestone D — RAG and tools

- [ ] Durable parent-child ingestion.
- [ ] Dense + sparse retrieval.
- [ ] `checkStock`, `cartManager`, `shippingCalculator`.
- [ ] Query/rag event logging.

### Milestone E — Order and manual payment

- [ ] COD.
- [ ] Bank transfer/QRIS manual.
- [ ] Proof attachment.
- [ ] Admin verification.
- [ ] Receipt text/PDF.
- [ ] Notification order/payment.

### Milestone F — Telegram

- [ ] Telegram adapter.
- [ ] Shared debounce/agent pipeline.
- [ ] Shared order/memory/profile logic.

### Milestone G — Resilience and optimization

- [ ] Provider capability tests.
- [ ] Round-robin keys.
- [ ] Safe read-only fallback.
- [ ] Query rewriting/reranking.
- [ ] Observability and evaluation.

## 11. Acceptance Criteria Revisi

- [ ] `moon run :dev` starts bot, admin-api, and admin-web without `tsx/vite command not found`.
- [ ] Admin can open `/whatsapp`, see a fresh QR, scan it, and see `connected`.
- [ ] Unpair removes stored auth and shows a new QR.
- [ ] WhatsApp burst messages become one agent run after 5 seconds.
- [ ] Session cart survives within 2 hours and resets after expiry.
- [ ] Customer preferences persist independently from short-term cart.
- [ ] Stock and price always come from PostgreSQL.
- [ ] RAG answers use active knowledge version and report no-answer when confidence is low.
- [ ] COD and manual transfer/QRIS flows create notifications and enter the correct admin queue.
- [ ] Handover pauses bot responses.
- [ ] Telegram uses the same normalized message pipeline after WhatsApp passes.
- [ ] Provider fallback does not duplicate order/payment side effects.

## 12. Explicitly Deferred

- Google Agents CLI/ADK integration.
- Next.js migration.
- Full multi-provider fallback before capability tests.
- Cohere reranking before baseline retrieval evaluation.
- OCR/PDF ingestion before Markdown/text ingestion is stable.
- Receipt image rendering before text/PDF receipt is reliable.
- Multi-instance WhatsApp scaling before database-backed auth state is verified.
