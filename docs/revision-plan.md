# Revision Plan: Productization & WhatsApp Migration

Status: Living document. Merevisi arah dari produk single-merchant berbasis Baileys menjadi platform multi-merchant dengan WhatsApp BSP resmi.

## 1. Direction Change

Arah produk berubah dari **chatbot untuk satu brand (Soysu)** menjadi **platform commerce WhatsApp untuk banyak merchant**, dengan Soysu sebagai merchant pertama / pilot tenant.

Perubahan kunci:

1. Satu codebase multi-tenant; merchant baru di-onboard, bukan dibuatkan aplikasi baru.
2. WhatsApp production memakai **satu BSP resmi untuk pilot**; Baileys hanya development.
3. Nomor WhatsApp existing dihubungkan via migrasi/coexistence resmi provider.
4. Payment MVP tetap QRIS manual + COD; payment gateway menyusul.
5. Inbox human CS multi-agent.
6. Delivery MVP berupa handoff ke merchant; GoSend/kurir berada di luar flow WhatsApp platform.
7. Target awal layanan terjangkau untuk 4–8 UMKM dengan setup dibantu.
8. Provider-agnostic via boundary stabil, bukan abstraction prematur.

## 2. Mengapa Baileys Development-Only

Baileys memakai protokol WhatsApp Web yang bukan API resmi:

- Risiko logout, limit, atau banned tanpa SLA.
- Tidak ada jaminan stabilitas dari WhatsApp.
- Setiap nomor butuh session/device state yang harus dioperasikan.
- Sulit horizontal scaling dan menjamin uptime.
- QR pairing adalah credential sensitif.

Posisi Baileys:

```text
Development adapter:
- berguna untuk local testing & demo internal;
- tidak tercakup SLA production;
- tidak dipakai untuk onboarding merchant;
- dapat dilepas per channel account.
```

## 3. Strategi Provider WhatsApp

- **Production pilot:** satu BSP resmi yang mendukung Indonesia dan onboarding nomor existing.
- **Jangka panjang:** evaluasi Cloud API direct jika jumlah merchant membuat biaya BSP tidak efisien.
- **Pola:** webhook inbound + outbound via API provider.
- **Ownership WABA:** merchant-owned; platform menyimpan reference (`waba_id`, `phone_number_id`) tanpa mengambil alih aset.
- **Onboarding:** verifikasi ownership, lalu migrasi penuh atau coexistence (tergantung dukungan provider/negara).
- **Baileys:** dev-only, dipakai untuk demo/template Soysu sampai nomor production resmi aktif.
- **Biaya:** Meta/BSP ditagihkan transparan sebagai pass-through; jangan disubsidi tanpa batas oleh platform.

## 4. Existing Number Onboarding

```text
Merchant hubungkan nomor existing
  → cek jenis akun & status WABA
  → verifikasi ownership
  → pilih migrasi penuh / coexistence
  → provisioning BSP
  → webhook registration
  → connected
```

Status onboarding:

```text
pending | verification_required | migration_required
provisioning | connected | failed | suspended
```

Catatan penting:

- QR Baileys BUKAN metode migrasi ke Cloud API.
- Coexistence tidak dijamin universal; validasi per provider.
- Soysu menjadi nomor pertama untuk memvalidasi proses ini.

## 5. Provider Adapter (BSP; Cloud API jangka panjang)

Kontrak internal (lihat `context-arch.md`):

```ts
interface ChannelAdapter {
  receiveEvent(event: unknown): Promise<void>;
  sendText(message: OutboundMessage): Promise<SendResult>;
  sendMedia(message: OutboundMediaMessage): Promise<SendResult>;
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
}
```

Business logic tidak mengenal payload Meta, JID Baileys, atau payload BSP.

## 6. Tenant-Aware Message Routing

Inbound webhook:

```text
verify signature
  → resolve channel_account dari phone_number_id
  → resolve tenant
  → dedup (channel_account_id + external_message_id)
  → normalize → persist → debounce → agent/human
```

Jika `phone_number_id` tidak dikenal: tolak/simpan sebagai unmatched event + alert. Jangan membuat tenant baru otomatis.

## 7. Migrasi dari Baileys Runtime

Tahapan:

1. Tambah `channel_accounts`; setiap nomor jadi satu account.
2. Pertahankan Baileys sebagai adapter sementara (dev).
3. Tambah adapter BSP + webhook.
4. Jalankan nomor baru (atau nomor migrasi resmi) lewat BSP dulu.
5. Setelah stabil, hentikan Baileys per account, bukan global.
6. Histori conversation dipertahankan via `tenant_id + channel_account_id + customer`.

Domain order/payment/conversation TIDAK berubah saat migrasi; hanya adapter yang diganti.

## 8. QRIS Manual & COD

### QRIS manual

```text
checkout → tampilkan QRIS merchant + total → pending_payment
→ customer kirim bukti → proof_submitted
→ admin cocokkan mutasi → paid | rejected
```

- QRIS config per tenant (`payment_configs`).
- Snapshot QRIS per order.
- Verifikasi dicatat `verified_by`/`verified_at`.
- Screenshot bukan bukti final; admin cek mutasi/dashboard merchant.

### COD

```text
checkout → konfirmasi merchant/admin → processing
→ handoff ke merchant → delivery di luar platform
```

- Platform mencatat metode COD dan handoff; collection/settlement merchant berada di luar MVP.

## 9. Human Inbox

- Handover jadi inbox multi-agent, bukan sekadar pause bot.
- Human dapat kirim pesan keluar (role `human`) via outbox.
- Bot pause/resume sesuai status handover.
- Trigger: low confidence, frustrasi, bulk order, tool failure berulang, permintaan eksplisit.
- Collision prevention saat dua CS membuka chat yang sama.

## 10. Delivery (Handoff ke Merchant)

- Saat pembayaran/COD terkonfirmasi, order siap di-handoff ke merchant.
- Merchant mengatur GoSend/kurir sendiri di luar flow WhatsApp platform.
- Platform hanya mencatat alamat, area, ongkir, dan status handoff.
- Dispatch, tracking otomatis, driver app, dan COD settlement ditunda.

## 11. Pilot Rollout

```text
Phase 0 → provider & existing-number validation (Soysu)
Phase 1-2 → multi-tenant + channel account
Phase 3 → messaging & inbox
Phase 4-6 → commerce, payment, delivery handoff
Phase 7-8 → workspace, tracing, usage/cost + hardening
Phase 9 → pilot Soysu → 4-8 merchant UMKM beta → launch
```

## 12. Production Exit Criteria

Yang TIDAK lagi menjadi acceptance criteria production:

- Admin scan QR Baileys sebagai flow production.
- Baileys reconnect sebagai core reliability.
- Global WhatsApp connection `default`.
- Single admin token.
- Single shared knowledge base.
- Single global catalog.

Kriteria production:

- Merchant onboarding via BSP berhasil (nomor existing).
- Webhook signature verified; dedup bekerja.
- Outbox + delivery status bekerja.
- Tenant isolation tervalidasi.
- Handover + human outbound bekerja.
- QRIS manual & COD state machine bekerja.
- Delivery handoff ke merchant tercatat; GoSend/kurir berada di luar flow platform.
- Di luar jam kerja, bot tidak membuat order aktif dan memberi pesan bahwa proses menunggu jam kerja.
- Platform operator dapat melihat health, usage, cost, dan AI trace seluruh tenant dengan audit.
- Observability, backup, dan runbook tersedia.

## 13. Explicitly Deferred

- Payment gateway otomatis (Xendit/Midtrans/DOKU).
- Omnichannel Instagram/TikTok.
- Import katalog marketplace.
- Iklan CTWA + CAPI.
- Telegram.
- Multi-provider LLM fallback kompleks.
- Reranker Cohere.
- Receipt image.
- Billing engine kompleks.
- Isolasi deployment per tenant.
- Banyak provider WhatsApp sekaligus aktif (satu production provider dulu).
- Integrasi GoSend/courier otomatis dan driver app.
