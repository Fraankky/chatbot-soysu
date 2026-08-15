export interface Product {
  id: string;
  name: string;
  flavor: string;
  sweetnessOptions: string[];
  price: number;
  stock: number;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "cancelled";

export interface OrderItem {
  sku: string;
  qty: number;
}

export interface Order {
  id: string;
  customerName: string;
  items: OrderItem[];
  status: OrderStatus;
  createdAt: string;
}

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

export const SEED_ORDERS: Order[] = [
  {
    id: "ORD-20260815-001",
    customerName: "Andi",
    items: [{ sku: "soysu-001", qty: 2 }],
    status: "pending",
    createdAt: "2026-08-15T08:00:00Z",
  },
  {
    id: "ORD-20260815-002",
    customerName: "Budi",
    items: [
      { sku: "soysu-002", qty: 1 },
      { sku: "soysu-003", qty: 3 },
    ],
    status: "confirmed",
    createdAt: "2026-08-15T09:30:00Z",
  },
];
