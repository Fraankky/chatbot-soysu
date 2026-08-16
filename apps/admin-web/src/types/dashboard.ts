export interface MetricCardProps {
  title: string;
  value: string;
  unit?: string;
  subText: string;
  trend: "up" | "down";
}

export interface Transaction {
  id: string;
  customer: string;
  product: string;
  status: "Success" | "Pending" | "Refunded";
  qty: number;
  price: string;
  total: string;
}

export interface MonthlySalesData {
  month: string;
  newUser: number;
  existingUser: number;
}
