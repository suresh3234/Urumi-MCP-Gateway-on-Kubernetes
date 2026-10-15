export interface OrderNote {
  id: string;
  orderId: number;
  note: string;
  isCustomerNote: boolean;
  author: string;
  createdAt: string;
}
