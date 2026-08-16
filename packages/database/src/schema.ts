import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return JSON.parse(value.slice(1, -1)) as number[];
  },
});

export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "pending_confirmation",
  "processing",
  "ready_to_deliver",
  "out_for_delivery",
  "completed",
  "cancelled",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "not_required",
  "pending",
  "paid",
  "failed",
  "expired",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["cod", "bank_transfer", "qris_manual"]);

export const handoverStatusEnum = pgEnum("handover_status", [
  "open",
  "assigned",
  "waiting_customer",
  "resolved",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "bot", "human"]);

export const channelEnum = pgEnum("channel", ["whatsapp", "telegram"]);

export const kbStatusEnum = pgEnum("kb_status", ["pending", "indexing", "active", "failed"]);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  phone: text("phone"),
  channel: channelEnum("channel").notNull(),
  externalId: text("external_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    status: text("status").default("active").notNull(),
    botPaused: boolean("bot_paused").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("conversations_channel_external").on(table.channel, table.externalId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    text: text("text").notNull(),
    mediaType: text("media_type"),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("messages_provider_id").on(table.providerMessageId),
    index("messages_conversation").on(table.conversationId),
  ],
);

export const waAuthSessions = pgTable("wa_auth_sessions", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const waConnections = pgTable("wa_connections", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("not_paired"),
  phoneNumber: text("phone_number"),
  deviceName: text("device_name"),
  lastQrAt: timestamp("last_qr_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  flavor: text("flavor").notNull(),
  sweetnessOptions: text("sweetness_options").array().notNull().default([]),
  price: integer("price").notNull(),
  stock: integer("stock").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  orderId: text("order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stockReservations = pgTable("stock_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id").notNull(),
  productId: text("product_id").notNull(),
  qty: integer("qty").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    qty: integer("qty").notNull(),
    sweetnessLevel: text("sweetness_level").notNull(),
  },
  (table) => [primaryKey({ columns: [table.cartId, table.productId] })],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    customerName: text("customer_name"),
    status: orderStatusEnum("status").notNull().default("draft"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
    deliveryArea: text("delivery_area"),
    deliveryAddress: text("delivery_address"),
    shippingCost: integer("shipping_cost").notNull().default(0),
    total: integer("total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("orders_status").on(table.status)],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  flavor: text("flavor").notNull(),
  name: text("name").notNull(),
  sweetnessLevel: text("sweetness_level").notNull(),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  method: paymentMethodEnum("method").notNull(),
  amount: integer("amount").notNull(),
  proofMessageId: text("proof_message_id"),
  proofFilePath: text("proof_file_path"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    orderId: text("order_id"),
    conversationId: uuid("conversation_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("notifications_unread").on(table.isRead)],
);

export const handovers = pgTable("handovers", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  status: handoverStatusEnum("status").notNull().default("open"),
  reason: text("reason"),
  assignedTo: text("assigned_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const handoverEvents = pgTable("handover_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id")
    .notNull()
    .references(() => handovers.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category").notNull().default("general"),
    status: kbStatusEnum("status").notNull().default("pending"),
    activeVersionId: uuid("active_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("kb_documents_title").on(table.title)],
);

export const kbDocumentVersions = pgTable("kb_document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => kbDocuments.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  embeddingDimensions: integer("embedding_dimensions").notNull(),
  status: kbStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const kbParents = pgTable("kb_parents", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentVersionId: uuid("document_version_id")
    .notNull()
    .references(() => kbDocumentVersions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const kbChildChunks = pgTable(
  "kb_child_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => kbParents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: embeddingVector("embedding").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("kb_chunks_embedding").using("hnsw", table.embedding.op("vector_cosine_ops"))],
);

export const kbIngestionJobs = pgTable("kb_ingestion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull(),
  status: kbStatusEnum("status").notNull().default("pending"),
  chunksCount: integer("chunks_count"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const ragEvents = pgTable("rag_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id"),
  query: text("query").notNull(),
  topScore: text("top_score"),
  noAnswer: boolean("no_answer").default(false).notNull(),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
