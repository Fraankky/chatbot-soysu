# Architecture & Technical Specification

Dokumen teknis sistem `soysu.id`: struktur repo, stack, komponen, alur data, dan konvensi.

## 1. Struktur Monorepo (moonrepo + pnpm)

```
soysu/
├── .moon/                     # moon repo config (workspace, toolchains, tasks)
├── apps/
│   ├── bot/                   # WA/CLI agent runtime (Anvia) — Service 1
│   │   ├── knowledge/         # knowledge base markdown untuk RAG
│   │   └── src/
│   │       ├── agent.ts       # AgentBuilder + tools
│   │       ├── tools.ts       # createTool: check_stock, rag_search, get_current_time
│   │       ├── rag.ts         # inisialisasi RAG + load knowledge base
│   │       └── index.ts       # CLI entry point (top-level await)
│   ├── admin-api/             # Admin BE — Service 2 (Hono, port 8787)
│   │   └── src/index.ts       # REST: /api/products, /api/orders
│   └── admin-web/             # Admin FE (Vite + React + TS)
│       └── src/               # dashboard (proxy /api → admin-api)
├── packages/
│   ├── rag/                   # RAG system (chunking, embedding, hybrid search)
│   └── shared/                # shared types + seed data (Product, Order, …)
├── docs/                      # PRD & arsitektur (dokumen ini)
├── AGENTS.md                  # panduan agent (rules + commands)
├── moon.yml                   # root project: format/lint/typecheck repo-wide
└── tsconfig.json              # single tsconfig mencakup semua src
```

### Prinsip pemisahan

- **apps/bot** = daemon stateful (koneksi WA), high-availability, event-driven. Tidak punya FE.
- **apps/admin-api** = stateless, bisa di-scale horizontal. Menangani CRUD, upload knowledge base, auth/RBAC.
- Keduanya berbagi database, tidak berbagi proses.

## 2. Tech Stack

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

## 3. Komponen

### 3.1 Anvia Agent (apps/bot)

- `AgentBuilder('soysu-chatbot', model)` dengan instructions (persona + grounding rule).
- Tools: `rag_search`, `check_stock`, `get_current_time`. `defaultMaxTurns(4)`.
- Response dibaca via `response.output`.

### 3.2 RAG (packages/rag)

Pipeline: `ingest(docs)` → chunking → embedding → simpan; `retrieve(query)` → embedding query → hybrid search.

- **Chunking:** `chunkText(title, text, maxSize=800)` — split paragraf, batas maks ukuran, `parentId` per grup paragraf (parent-child).
- **Embedder:** interface `Embedder` + `OpenAIEmbedder` (struktural ke `embedTexts` anvia). Mudah diganti provider lain.
- **Hybrid search:** `VectorStore` (in-memory saat ini; migrasi ke pgvector menyusul).
  Dense = cosine similarity, sparse = token overlap. Bobot:

  ```
  CombinedScore = 0.7 * Dense + 0.3 * Sparse
  ```

- **Store saat ini in-memory.** Target: PostgreSQL + pgvector (schema di bawah), Redis untuk session/debounce.

### 3.3 Admin API (apps/admin-api)

Hono REST:

- `GET /api/products`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`
- `GET /api/orders`
- `GET /health`
- CORS dibuka untuk `/api/*`. Data in-memory dari `SEED_PRODUCTS` / `SEED_ORDERS` (belum ada DB).

### 3.4 Admin Web (apps/admin-web)

Vite + React SPA. `vite.config.ts` proxy `/api` → `http://localhost:8787`. Dashboard menampilkan tabel produk.

## 4. Data Layer (target)

### 4.1 PostgreSQL + pgvector

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE kb_parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    full_content TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kb_child_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES kb_parents(id) ON DELETE CASCADE,
    chunk_content TEXT NOT NULL,
    embedding vector(1536),
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_content)) STORED,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kb_child_embedding ON kb_child_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_kb_child_tsv ON kb_child_chunks USING gin (tsv_content);
```

### 4.2 Redis

- Sliding window debounce burst message (5 dtk) per nomor.
- Session memory & state keranjang.

## 5. Konvensi & Lingkungan

- **Environment variables** (per-app, mis. `apps/bot/.env`): `OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT` (admin-api). Jangan commit `.env`.
- **Modul import antar package:** via `workspace:*` + `exports` menunjuk ke `src/index.ts` (langsung konsumsi source, tsx/vite/tsc menangani TS).
- **Validasi semua input eksternal** (tool args, body request) dengan zod.

## 6. Roadmap

1. [x] Monorepo + RAG in-memory + admin CRUD skeleton
2. [ ] Persistent store (PostgreSQL + pgvector, Redis)
3. [ ] WhatsApp gateway (Baileys) + debounce burst + typing simulation
4. [ ] Reranker (Cohere/RRf) & query rewriting
5. [ ] Auth admin (JWT/session) + handover interface
