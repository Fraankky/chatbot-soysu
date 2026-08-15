# AGENTS.md

Panduan kerja untuk AI coding agents di repository ini.

## Golden Rules

- **"I prefer stupid simple code instead of smart one."** Tulis kode paling sederhana yang berfungsi. Hindari abstraksi, generics, dan pola "pintar" yang tidak diperlukan.
- **"No need to create fallback and backward compatibility unless user asking to do so."** Jangan tambah fallback, migration shim, atau dukungan versi lama. Kalau kode lama mau diubah, ubah langsung.

## Kerja Efisien

- Balas dengan bahasa yang dipakai user (Indonesia default).
- Hemat token: eksplorasi hanya bagian relevan, jangan baca file besar utuh tanpa perlu.
- Prefer edit kecil dan presisi, hindari menulis ulang file utuh.
- Gunakan subagent untuk pencarian luas; jaga konteks utama tetap ringan.
- Jangan tambahkan komentar kecuali diminta.

## Kualitas & Keamanan Kode

- Strict TypeScript: tidak ada `any`, tidak ada non-null assertion (`!`) tanpa alasan jelas.
- Tanpa komentar yang tidak perlu.
- Validasi semua input eksternal (tool args, request body) dengan zod.
- Jangan menaruh secret di kode. Pakai `.env` (sudah di `.gitignore`), jangan commit.
- Jangan menambah dependency tanpa kebutuhan.
- Periksa konvensi project sebelum menulis kode baru.
- Setelah mengubah kode, jalankan verifikasi di bawah.
- Jangan commit kecuali diminta.

## Struktur Project

- `apps/bot` — Anvia agent runtime (CLI/WA), knowledge base di `apps/bot/knowledge/`.
- `apps/admin-api` — Hono REST API (admin BE).
- `apps/admin-web` — Vite + React dashboard (admin FE).
- `packages/rag` — RAG system (chunker, embedder, hybrid vector store).
- `packages/shared` — shared types + seed data.
- `docs/` — PRD (`context.md`) & arsitektur (`context-arch.md`).
- Doc PRD/arsitektur ini adalah sumber kebenaran bisnis — sinkronkan bila strukturnya berubah.

## Commands

Semua task terpusat lewat moonrepo (dijalankan dari root):

```bash
pnpm install            # install semua workspace deps
pnpm moon run :format   # oxfmt seluruh repo
pnpm moon run :lint     # oxlint seluruh repo
pnpm moon run :typecheck
pnpm moon run :format :lint :typecheck   # verifikasi lengkap
pnpm moon run bot:dev          # jalankan chatbot CLI
pnpm moon run admin-api:dev    # admin API :8787
pnpm moon run admin-web:dev    # admin web (proxy /api → :8787)
```

Verifikasi wajib setelah mengubah kode: `pnpm moon run :format :lint :typecheck`.

## Konvensi Teknis

- ESM (`"type": "module"`), dijalankan dengan `tsx`.
- Import antar package memakai nama package (`@soysu/*`) lewat pnpm `workspace:*`; `exports` mengarah ke `src/index.ts` langsung.
- Formatter/linter: **oxfmt + oxlint** (bukan prettier/eslint).
- Tool agent didefinisikan dengan `createTool` dari `@anvia/core` (zod untuk schema input).
