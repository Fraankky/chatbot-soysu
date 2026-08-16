CREATE TABLE IF NOT EXISTS "wa_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'not_paired' NOT NULL,
  "phone_number" text,
  "device_name" text,
  "last_qr_at" timestamp with time zone,
  "connected_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
