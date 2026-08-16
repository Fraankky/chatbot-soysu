import { createTool } from "@anvia/core";
import { ilike, sql } from "drizzle-orm";
import { z } from "zod";

import {
  addToCart,
  attachPaymentProof,
  checkout,
  ensureConversation,
  getCart,
  listCartItems,
  removeCartItem,
  updateCartItem,
} from "@soysu/database";
import { payments, products } from "@soysu/database/schema";
import { DELIVERY_AREAS, SHIPPING_COST } from "@soysu/shared";

import { db, rag } from "./context.js";
import { generateReceipt } from "./receipt.js";
import type { DB } from "@soysu/database";

async function findProduct(flavor: string) {
  const [row] = await db
    .select()
    .from(products)
    .where(ilike(products.flavor, `%${flavor}%`))
    .limit(1);
  return row;
}

async function cartSummary(dbClient: DB, conversationId: string): Promise<string> {
  const cart = await getCart(dbClient, conversationId);
  const items = await listCartItems(dbClient, cart.id);
  if (items.length === 0) return "Keranjang kosong.";
  const lines = items.map(
    (i) => `${i.product.flavor} x${i.qty} (${i.sweetnessLevel}) - Rp ${i.product.price * i.qty}`,
  );
  const subtotal = items.reduce((s, i) => s + i.product.price * i.qty, 0);
  return lines.join("\n") + `\nSubtotal: Rp ${subtotal}`;
}

export function createTools(conversationId: string) {
  const ensure = () => ensureConversation(db, "whatsapp", conversationId);

  const ragSearch = createTool({
    name: "rag_search",
    description:
      "Search the knowledge base for info about products, ingredients, storage, and delivery.",
    input: z.object({ query: z.string() }),
    async execute({ query }) {
      const hits = await rag.retrieve(query, 3);
      if (hits.length === 0) return "Tidak ada info relevan di knowledge base.";
      return hits.map((h) => `[${h.title}] ${h.content}`).join("\n\n");
    },
  });

  const checkStock = createTool({
    name: "check_stock",
    description: "Check current price and stock of a soy milk flavor.",
    input: z.object({ flavor: z.string() }),
    async execute({ flavor }) {
      const p = await findProduct(flavor);
      if (!p) return `Produk "${flavor}" tidak ditemukan.`;
      return (
        `${p.name} - Rp ${p.price}, stok ${p.stock} botol. ` +
        `Pilihan manis: ${p.sweetnessOptions.join(", ")}.\n` +
        "Cara pesan: sebutkan jumlah, tingkat manis, area, alamat, dan metode pembayaran. " +
        "Pembayaran tersedia: COD, transfer bank, atau QRIS manual."
      );
    },
  });

  const listProducts = createTool({
    name: "list_products",
    description:
      "List all available Soysu products with current price, stock, and sweetness options.",
    input: z.object({}),
    async execute() {
      const rows = await db.select().from(products);
      if (rows.length === 0) return "Belum ada produk tersedia.";
      return rows
        .map(
          (p) =>
            `${p.name} (${p.flavor}): Rp ${p.price}, stok ${p.stock}, manis: ${p.sweetnessOptions.join(", ")}`,
        )
        .join("\n");
    },
  });

  const cartManager = createTool({
    name: "cart_manager",
    description: "Manage the customer's cart: add, remove, update quantity, or show items.",
    input: z.object({
      action: z.enum(["add", "remove", "update", "show"]),
      flavor: z.string().optional(),
      qty: z.number().int().positive().optional(),
      sweetnessLevel: z.enum(["Normal", "Less Sugar", "Zero Sugar"]).optional(),
    }),
    async execute({ action, flavor, qty, sweetnessLevel }) {
      const conv = await ensure();
      if (action === "show") return cartSummary(db, conv.id);

      if (!flavor) throw new Error("flavor required");
      const product = await findProduct(flavor);
      if (!product) return `Produk "${flavor}" tidak ditemukan.`;

      if (action === "add") {
        if (!qty || !sweetnessLevel) throw new Error("qty and sweetnessLevel required");
        await addToCart(db, conv.id, product.id, qty, sweetnessLevel);
        return (
          `Ditambahkan: ${product.flavor} x${qty} (${sweetnessLevel}).\n` +
          (await cartSummary(db, conv.id))
        );
      }
      if (action === "update") {
        if (!qty || !sweetnessLevel) throw new Error("qty and sweetnessLevel required");
        await updateCartItem(db, conv.id, product.id, qty, sweetnessLevel);
        return (
          `Diperbarui: ${product.flavor} x${qty} (${sweetnessLevel}).\n` +
          (await cartSummary(db, conv.id))
        );
      }
      await removeCartItem(db, conv.id, product.id);
      return `Dihapus: ${product.flavor}.\n` + (await cartSummary(db, conv.id));
    },
  });

  const shippingCalculator = createTool({
    name: "shipping_calculator",
    description: "Validate delivery area and calculate shipping cost.",
    input: z.object({
      area: z.string().describe("Delivery area, e.g. Sleman, Bantul, Kota Yogyakarta"),
    }),
    async execute({ area }) {
      const match = DELIVERY_AREAS.find((a) => a.toLowerCase() === area.toLowerCase());
      if (!match)
        return `Maaf, area "${area}" belum didukung. Kami melayani: ${DELIVERY_AREAS.join(", ")}.`;
      return `${match}: didukung. Ongkir Rp ${SHIPPING_COST}.`;
    },
  });

  const checkoutPreview = createTool({
    name: "checkout_preview",
    description:
      "Preview the current cart total, shipping, and payment status without creating an order or changing stock.",
    input: z.object({
      deliveryArea: z.string(),
      paymentMethod: z.enum(["cod", "bank_transfer", "qris_manual"]),
    }),
    async execute({ deliveryArea, paymentMethod }) {
      const area = DELIVERY_AREAS.find((item) => item.toLowerCase() === deliveryArea.toLowerCase());
      if (!area) return `Area tidak didukung. Area tersedia: ${DELIVERY_AREAS.join(", ")}.`;
      const conv = await ensure();
      const cart = await getCart(db, conv.id);
      const items = await listCartItems(db, cart.id);
      if (items.length === 0) return "Keranjang kosong.";
      const subtotal = items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
      const total = subtotal + SHIPPING_COST;
      const lines = items.map(
        (item) =>
          `- ${item.product.name} x${item.qty} (${item.sweetnessLevel}): Rp ${item.product.price * item.qty}`,
      );
      return [
        "Ringkasan pesanan:",
        ...lines,
        `Subtotal: Rp ${subtotal}`,
        `Ongkir ${area}: Rp ${SHIPPING_COST}`,
        `Total: Rp ${total}`,
        `Pembayaran: ${paymentMethod}`,
        "Ini masih preview. Belum ada order dan stok belum berubah.",
      ].join("\n");
    },
  });

  const checkoutTool = createTool({
    name: "checkout",
    description: "Confirm and place the order. Use ONLY after the customer explicitly confirms.",
    input: z.object({
      paymentMethod: z.enum(["cod", "bank_transfer", "qris_manual"]),
      deliveryArea: z.string(),
      deliveryAddress: z.string(),
    }),
    async execute({ paymentMethod, deliveryArea, deliveryAddress }) {
      const area = DELIVERY_AREAS.find((item) => item.toLowerCase() === deliveryArea.toLowerCase());
      if (!area) return `Area tidak didukung. Area tersedia: ${DELIVERY_AREAS.join(", ")}.`;
      if (!deliveryAddress.trim()) return "Alamat pengiriman wajib diisi sebelum checkout.";
      const conv = await ensure();
      const order = await checkout(db, {
        conversationId: conv.id,
        paymentMethod,
        deliveryArea: area,
        deliveryAddress,
      });
      let message = `Order ${order.id} dibuat!\nStatus: ${order.status}\nTotal: Rp ${order.total}`;
      if (paymentMethod !== "cod") {
        message += `\nMohon transfer dan kirim bukti pembayaran (bank_transfer: ke rekening kami / qris_manual: scan QRIS).`;
      } else {
        message += `\nOrder menunggu konfirmasi admin.`;
      }
      return message;
    },
  });

  const attachProofTool = createTool({
    name: "attach_payment_proof",
    description:
      "Attach a payment proof message id to the latest unpaid order. Use after customer sends transfer proof.",
    input: z.object({ proofMessageId: z.string() }),
    async execute({ proofMessageId }) {
      const conv = await ensure();
      const [pending] = await db
        .select()
        .from(payments)
        .where(
          sql`order_id in (select id from orders where conversation_id = ${conv.id}) and status = 'pending'`,
        )
        .orderBy(payments.createdAt)
        .limit(1);
      if (!pending) return "Tidak ada pembayaran yang menunggu.";
      await attachPaymentProof(db, pending.orderId, proofMessageId);
      return "Bukti pembayaran terlampir, menunggu verifikasi admin.";
    },
  });

  const getReceipt = createTool({
    name: "get_receipt",
    description:
      "Show the receipt text for the latest order. Use after checkout or when customer asks for receipt.",
    input: z.object({}),
    async execute() {
      const conv = await ensure();
      const rows =
        await db.$client`select id from orders where conversation_id = ${conv.id} order by created_at desc limit 1`;
      if (!rows[0]) return "Belum ada order.";
      return generateReceipt(db, rows[0].id);
    },
  });

  return [
    ragSearch,
    checkStock,
    listProducts,
    cartManager,
    shippingCalculator,
    checkoutPreview,
    checkoutTool,
    attachProofTool,
    getReceipt,
  ];
}
