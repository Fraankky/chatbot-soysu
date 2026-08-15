import type { DB } from "@soysu/database";
import { getOrder } from "@soysu/database";

export async function generateReceipt(db: DB, orderId: string): Promise<string> {
  const order = await getOrder(db, orderId);
  if (!order) throw new Error("Order tidak ditemukan");

  const lines = [
    "=========== SOYSU.ID ===========",
    "Struk Pesanan",
    `Order ID : ${order.id}`,
    `Tanggal  : ${order.createdAt.toISOString()}`,
    `Status   : ${order.status}`,
    `Bayar    : ${order.paymentMethod} (${order.paymentStatus})`,
    "-------------------------------",
  ];
  for (const item of order.items) {
    lines.push(
      `${item.name} (${item.sweetnessLevel}) x${item.qty}  Rp ${item.unitPrice * item.qty}`,
    );
  }
  lines.push("-------------------------------");
  lines.push(`Ongkir   : Rp ${order.shippingCost}`);
  lines.push(`TOTAL    : Rp ${order.total}`);
  lines.push(`Area     : ${order.deliveryArea ?? "-"}`);
  lines.push(`Alamat   : ${order.deliveryAddress ?? "-"}`);
  lines.push("===============================");
  return lines.join("\n");
}
