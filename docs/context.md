# PRD: Multi-Merchant WhatsApp Commerce Platform

Status: Living document. Update saat produk berkembang.

## 1. Product Vision

Platform commerce bertenaga AI yang memungkinkan banyak merchant berjualan langsung di WhatsApp — tanpa marketplace, tanpa potongan komisi, dengan nomor WhatsApp dan customer yang tetap milik merchant.

**Soysu** adalah brand susu kedelai artisanal D2C di Semarang Atas dan merupakan **merchant pertama / pilot tenant** platform ini. Knowledge base Soysu bersumber dari data resmi merchant, termasuk `soysu.co.id`, lalu diverifikasi sebelum aktif. Semua data, persona, dan konfigurasi Soysu adalah konfigurasi tenant, bukan produk terpisah.

## 2. Product Positioning

- Bukan sekadar chatbot, melainkan **commerce operating system di WhatsApp** untuk merchant Indonesia.
- Target komersial: SaaS multi-merchant dengan model biaya tetap (platform) + tarif pesan WhatsApp resmi Meta.
- Pembeda awal: flow order sederhana, QRIS manual + COD, chatbot aktif di luar jam kerja tanpa memproses penjualan, dan handover rapi ke human CS.
- Target awal adalah layanan terjangkau untuk UMKM dengan setup dibantu dan konfigurasi workflow per bisnis.
- Payment gateway otomatis, omnichannel (Instagram/TikTok), import katalog marketplace, CAPI, dan repeat order menyusul di fase berikutnya.

## 3. Target Customers

1. Merchant D2C/F&B yang sudah aktif jualan dan memiliki nomor WhatsApp existing.
2. Merchant yang selama ini dilayani manual oleh tim CS (banyak chat pesanan produk).
3. Merchant yang ingin lepas dari potongan marketplace.

## 4. Personas

- **Merchant owner:** ingin jualan tanpa biaya komisi; ingin tahu order dan revenue; ingin customer miliknya sendiri.
- **CS/operator:** menangani inbox, verifikasi pembayaran, handover, dan delivery.
- **Delivery:** merchant mengatur pengiriman, misalnya melalui GoSend, di luar flow WhatsApp platform pada MVP.
- **Pembeli:** chat, pilih produk, konfirmasi, bayar, lacak, dan repeat order.

## 5. Core Problems

- **Latensi:** pembeli D2C ingin balasan detik untuk stok dan pengiriman.
- **Burst message:** pengguna WA sering kirim beberapa pesan terpotong; bot harus menggabungkan dan mencegah race condition.
- **Akurasi:** stok & harga wajib dari data real-time, bukan tebakan model.
- **Sentuhan manusia:** komunikasi ramah sesuai persona brand; AI dibantu manusia saat ambigu.
- **Onboarding:** merchant punya nomor existing; proses koneksi ke platform resmi harus terpandu.
- **Multi-tenant:** data dan konfigurasi tiap merchant harus terisolasi di satu platform.

## 6. Product Principles

1. **Satu platform, banyak tenant.** Satu codebase dan arsitektur; tidak ada aplikasi per merchant. Merchant baru di-onboard, bukan dibuatkan aplikasi baru.
2. **AI membantu, bukan sumber kebenaran.** AI hanya memfasilitasi percakapan; order, payment, dan status berasal dari service + state machine.
3. **Stok & harga wajib real-time.** Dari tool call ke database, bukan RAG atau tebakan.
4. **Checkout hanya setelah konfirmasi eksplisit.** Semua side effect idempotent.
5. **Provider-agnostic via boundary stabil, bukan abstraction prematur.** WhatsApp, payment, dan courier diisolasi lewat domain model + kontrak kecil; adapter hanya ditambah saat provider kedua benar-benar dibutuhkan.
6. **Screenshot bukan bukti pembayaran final.** Verifikasi pembayaran manual dicocokkan dengan mutasi/dashboard merchant.
7. **Customer dan nomor milik merchant.** Data customer tersimpan per tenant dan dapat diekspor.
8. **Kode sederhana.** Hindari abstraksi, fallback, dan backward-compatibility yang tidak diperlukan.

## 7. Merchant Onboarding

```text
Merchant signup
  → setup profil merchant & user
  → hubungkan nomor WhatsApp existing (verifikasi ownership)
  → onboarding Meta/BSP: migrasi penuh atau coexistence
  → setup katalog, stok, QRIS, area pengiriman, knowledge base, brand voice
  → uji koneksi + pesan test
  → merchant active
```

Eligibility nomor existing bergantung provider: jenis akun, status WhatsApp Business Account, dukungan coexistence, dan kebijakan Meta. Soysu menjadi nomor pertama yang memvalidasi proses ini sebelum merchant lain onboard.

## 8. WhatsApp Customer Journey

```text
Pembeli masuk ke WhatsApp (dari iklan, IG, link-in-bio, QR)
  → AI menyapa & menjawab
  → AI baca katalog & stok live
  → customer pilih produk & varian
  → cart tersusun
  → checkout preview
  → konfirmasi eksplisit
  → order dibuat
  → bayar (QRIS manual) atau COD
  → admin/CS proses order
  → order diserahkan ke merchant untuk pengiriman
  → tracking di chat
  → repeat order
```

## 9. Commerce Flow

- **Catalog:** produk, varian (mis. sweetness), harga, stok per tenant.
- **Cart:** unique per tenant + customer/conversation; expiry; tidak langsung kurangi stok permanen.
- **Checkout preview:** ringkasan eksplisit (item, subtotal, ongkir, total, alamat, metode bayar) sebelum konfirmasi.
- **Order:** dibuat hanya setelah konfirmasi eksplisit; snapshot harga; idempotency; reserve stok transaksional.
- **State:** order dan payment mengikuti state machine ketat; semua perubahan dicatat (actor, timestamp, audit).

## 10. Jam Operasional, Human CS & Handover

- **AI-assisted customer service:** AI menangani FAQ, katalog, cart, checkout preview, status order.
- **Human menangani:** komplain, bulk order, alamat bermasalah, refund, verifikasi pembayaran manual, kasus ambigu.
- Human dapat mengambil alih conversation; bot benar-benar berhenti membalas saat handover aktif.
- Human CS dapat mengirim pesan keluar dari inbox (role `human`) melalui jalur pengiriman yang sama.
- Semua aktivitas handover tercatat di event log.
- Pada jam kerja, order dapat diproses oleh bot dan/atau human sesuai workflow merchant.
- Di luar jam kerja, bot tetap menjawab FAQ dan dapat menyusun draft/cart, tetapi tidak membuat penjualan aktif.
- Pesan di luar jam kerja wajib menjelaskan bahwa pemesanan menunggu jam kerja dan response human dapat lebih lambat.
- Jam kerja, timezone, hari libur, dan cutoff order disimpan sebagai konfigurasi tenant, bukan hanya instruksi prompt.

## 11. Payment

- **MVP:** QRIS manual dan COD. Tanpa payment gateway pada MVP.
- QRIS manual:

  ```text
  checkout → tampilkan QRIS merchant + total → pending_payment
  → customer kirim bukti → proof_submitted
  → admin cocokkan mutasi → paid | rejected
  ```

- COD:

  ```text
  checkout → konfirmasi merchant/admin → processing
  → handoff ke merchant → delivery di luar platform
  ```

- Bukti adalah lampiran, bukan sumber kebenaran. Admin memverifikasi dari mutasi/dashboard merchant.
- Verifikasi dicatat dengan `verified_by` + `verified_at`.
- Expiry pembayaran melepas reservasi stok.
- Platform mencatat metode COD dan handoff; collection/settlement GoSend atau merchant berada di luar MVP.
- Payment gateway (Xendit/Midtrans/DOKU) fase berikutnya: webhook harus idempotent dan signature diverifikasi. Tidak menyimpan kartu/CVV.

## 12. Delivery

- Pada MVP, pengiriman dilakukan merchant di luar flow WhatsApp platform, misalnya melalui GoSend.
- Platform menyimpan alamat, area, ongkir, dan status handoff ke merchant; tidak membangun dispatch/driver app.
- Integrasi courier dan tracking otomatis ditunda sampai ada kebutuhan nyata dari beberapa merchant.

## 13. Admin Workspace

Menu merchant:

```text
Overview
Inbox
Orders
Payments
Products
Stock
Delivery
Customers
Knowledge Base
WhatsApp Setup
Team & Roles
Merchant Settings
Audit Log
```

## 14. Multi-Tenant Requirements

- `tenant_id` menjadi boundary utama hampir semua data bisnis.
- Request context berisi `tenantId`, `userId`, role; tenant tidak dipercaya dari body request.
- RBAC per tenant: `admin`, `operator`, `viewer`; membership via `tenant_users`.
- Unique key komposit per tenant + provider, misal `(tenant_id, channel_account_id, external_message_id)`.
- Credential WhatsApp per merchant tersimpan terenkripsi dan tidak pernah masuk response API.
- Knowledge base, RAG, notification, dan audit terisolasi per tenant.
- Tracing AI menyimpan prompt/context reference, model, tool calls, retrieval score, response, latency, token usage, dan error tanpa menyimpan secret.
- Platform operator memiliki akses support terkontrol dan seluruh akses ke data merchant diaudit.

## 15. Security & Compliance

- API key WhatsApp dan auth admin terpisah total.
- Secret via environment; rotasi dan tidak di-commit.
- Webhook signature verification.
- CORS non-wildcard di production; request ID + structured logging.
- Tidak menyimpan data sensitif yang tidak perlu; customer dapat minta penghapusan profil.
- Back-up database, restore test, health check, graceful shutdown.

## 16. Non-Functional Requirements

- **Akurasi:** >98% akurasi jawaban stok dan harga.
- **Latensi:** acknowledgement instan; P95 agent run setelah debounce < 4 detik (di luar window debounce 5 dtk).
- **Isolasi:** bot tidak terganggu proses admin; tenant tidak bisa mengakses data tenant lain.
- **Keamanan:** strict TypeScript, validasi zod, oxfmt/oxlint lewat moon.
- **Reliabilitas:** outbound via outbox; idempotency; retry; monitoring per channel account.

## 17. Metrics

| Metric                              | Target                          |
| ----------------------------------- | ------------------------------- |
| Merchant activation rate            | terukur per kohort onboarding   |
| Time-to-first-order per merchant    | menurun per kohort              |
| WhatsApp connection success rate    | ≥ 95%                           |
| Order conversion rate               | tracking per merchant           |
| Payment verification time           | tracking P50/P95                |
| COD delivery success rate           | ≥ 90%                           |
| Human handover resolution time      | tracking P50/P95                |
| Message delivery failure rate       | ≤ 1%                            |
| Tenant data isolation incidents     | 0                               |
| Akurasi jawaban stok/harga          | > 98%                           |
| P95 response time                   | < 4 dtk (setelah debounce)      |
| Rasio eskalasi ke manusia           | < 10%                           |
| Gross merchandise value per tenant  | tracking per merchant           |
| Active merchants & retention        | tracking per bulan              |

## 18. MVP Scope

1. Multi-tenant foundation (`tenants`, `tenant_users`, roles, merchant settings, audit).
2. Channel account + onboarding nomor existing (BSP pilot; Baileys dev-only).
3. Messaging inbound (webhook, dedup, normalisasi) + outbound (outbox).
4. Inbox human CS (handover, human outbound, bot pause/resume).
5. Catalog, cart, checkout, order (idempotent, snapshot harga, reserve stok).
6. Payment QRIS manual + COD (config per merchant, verifikasi, expiry).
7. Delivery handoff ke merchant (mis. GoSend) tanpa integrasi courier pada MVP.
8. Merchant workspace + platform operator dashboard.
9. Pilot: Soysu sebagai tenant pertama; lalu 4–8 merchant UMKM beta.
10. Usage, cost, support, dan billing records dasar.

## 19. Deferred Scope

- Payment gateway otomatis (Xendit/Midtrans/DOKU).
- Omnichannel Instagram/TikTok.
- Import katalog marketplace.
- Iklan CTWA + CAPI.
- Telegram.
- Multi-provider LLM fallback kompleks.
- Reranker Cohere.
- Receipt image.
- Billing engine kompleks.
- Isolasi deployment per tenant (kecuali kebutuhan enterprise).
- Integrasi courier otomatis dan driver app.
- Full self-service onboarding tanpa bantuan platform.
