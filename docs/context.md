# PRD: Soysu WhatsApp AI Agent

Status: Living document. Update saat produk berkembang.

## 1. Vision

`soysu.id` adalah brand susu kedelai artisanal D2C di Daerah Istimewa Yogyakarta (Sleman, Kota Yogyakarta, Bantul) dengan WhatsApp sebagai saluran utama interaksi dan penjualan.

Proyek ini membangun **Customer Service & Sales Agentic Chatbot** yang memahami konteks pelanggan, menjawab pertanyaan produk secara akurat tanpa halusinasi, membantu penyusunan keranjang pesanan, dan menangani pertanyaan daya simpan serta pengiriman.

## 2. Problem Statement

- **Latensi:** pelanggan D2C ingin balasan dalam hitungan detik untuk stok dan pengiriman.
- **Burst message:** pengguna WA sering kirim beberapa pesan terpotong dalam sekali waktu; bot harus menggabungkannya dan mencegah race condition.
- **Akurasi:** jawaban stok & harga wajib dari data real-time, bukan tebakan dari dokumen.
- **Sentuhan manusia:** komunikasi harus ramah dan sesuai persona brand, tidak kaku seperti mesin.

## 3. Brand Voice & Aturan Komunikasi

- **Bahasa:** Indonesia santai-sopan, conversational.
- **Sapaan:** "Kak" / "Gann".
- **Simulasi manusia:** delay berbasis panjang pesan dan indikator mengetik sebelum menjawab.
- **Grounding rule:** stok dan harga WAJIB lewat tool call ke sumber data, bukan dari RAG.

## 4. Functional Requirements

### 4.1 Percakapan & Intent

1. **FAQ & knowledge (Agentic RAG):** bahan baku, cara simpan, daya simpan, pilihan kadar gula. Gunakan hybrid RAG (dense + sparse).
2. **Cek stok & produk real-time:** ketersediaan rasa (Matcha, Original, Brown Sugar, dsb.) lewat tool call.
3. **Penyusunan keranjang:** akumulasi item pesanan ke session, mendukung penyesuaian sweetness (Normal / Less Sugar / Zero Sugar).
4. **Normalisasi alamat & cek pengiriman:** identifikasi area (Depok, Sleman, Bantul, dekat kampus) dan estimasi kelayakan pengiriman.
5. **Human escalation:** alihkan ke admin saat ada indikasi frustrasi, pesanan besar (bulk), atau relevansi RAG di bawah ambang batas.

### 4.2 Admin Dashboard

1. **Manajemen RAG:** tambah/ubah FAQ dan dokumen knowledge base.
2. **Manajemen stok & order:** ubah stok rasa, lihat histori transaksi, atur harga.
3. **Human handover interface:** daftar percakapan yang butuh penanganan manusia.

## 5. Non-Functional Requirements

- **Akurasi:** >98% keakuratan jawaban stok dan harga.
- **Latensi:** overall P95 < 4 detik (termasuk buffer debounce 5 detik).
- **Isolasi:** bot WhatsApp tidak terganggu oleh proses admin (upload dokumen, CRUD) — keduanya dipisah.
- **Keamanan:** API key WhatsApp dan auth admin terpisah total.
- **Kualitas kode:** strict TypeScript, formatter oxfmt, linter oxlint, dieksekusi lewat moon.

## 6. Key Metrics

| Metric                                | Target                         |
| ------------------------------------- | ------------------------------ |
| Akurasi jawaban stok/harga            | > 98%                          |
| P95 response time                     | < 4 dtk                        |
| Rasio eskalasi ke manusia             | < 10%                          |
| Konversi keranjang → konfirmasi order | meningkat (tracking per batch) |

## 7. User Journey

```
User kirim pesan di WA
  ▼
Gateway WA (Baileys) + debounce burst message (5 dtk)
  ▼
Inisialisasi context/state (PostgreSQL + Redis)
  ▼
Anvia Agent Orchestrator
  ├── Intent classification
  ├── RAG query / tool call (stok, harga)
  └── Assembly response
  ▼
Simulasi mengetik + kirim balasan
```
