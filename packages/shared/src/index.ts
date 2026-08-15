export type Channel = "whatsapp" | "telegram";

export interface InboundMessage {
  channel: Channel;
  externalMessageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  mediaType?: "image" | "document" | null;
  receivedAt: Date;
}

export interface OutboundMessage {
  conversationId: string;
  text: string;
  mediaBuffer?: Buffer;
  mediaMime?: string;
}

export interface ChannelAdapter {
  connect(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  setTyping(conversationId: string, typing: boolean): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}

export type OrderStatus =
  | "draft"
  | "pending_confirmation"
  | "processing"
  | "ready_to_deliver"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type PaymentStatus = "not_required" | "pending" | "paid" | "failed" | "expired";

export type PaymentMethod = "cod" | "bank_transfer" | "qris_manual";

export type HandoverStatus = "open" | "assigned" | "waiting_customer" | "resolved";

export type MessageRole = "user" | "bot" | "human";

export type NotificationType =
  | "new_order"
  | "payment_proof"
  | "payment_paid"
  | "payment_expired"
  | "stock_low"
  | "handover_request"
  | "order_action_needed"
  | "delivery_failed"
  | "indexing_finished";

export interface CartItem {
  sku: string;
  qty: number;
  sweetnessLevel: "Normal" | "Less Sugar" | "Zero Sugar";
}

export interface Product {
  id: string;
  name: string;
  flavor: string;
  sweetnessOptions: string[];
  price: number;
  stock: number;
}

export interface OrderItem {
  sku: string;
  flavor: string;
  name: string;
  sweetnessLevel: "Normal" | "Less Sugar" | "Zero Sugar";
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customerName: string;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
}

export const DELIVERY_AREAS = ["Sleman", "Bantul", "Kota Yogyakarta"] as const;
export type DeliveryArea = (typeof DELIVERY_AREAS)[number];

export const SHIPPING_COST = 8000;

export const SEED_PRODUCTS: Product[] = [
  {
    id: "soysu-001",
    name: "Soysu Original",
    flavor: "Original",
    sweetnessOptions: ["Normal", "Less Sugar", "Zero Sugar"],
    price: 12000,
    stock: 40,
  },
  {
    id: "soysu-002",
    name: "Soysu Matcha",
    flavor: "Matcha",
    sweetnessOptions: ["Normal", "Less Sugar", "Zero Sugar"],
    price: 15000,
    stock: 25,
  },
  {
    id: "soysu-003",
    name: "Soysu Brown Sugar",
    flavor: "Brown Sugar",
    sweetnessOptions: ["Normal", "Less Sugar"],
    price: 15000,
    stock: 30,
  },
];
