import { z } from 'zod';

export const AllowedOrderStatuses = [
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
  'trash',
] as const;

export type OrderStatus = (typeof AllowedOrderStatuses)[number];

export const ListProductsSchema = z.object({
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
});

export type ListProductsInput = z.infer<typeof ListProductsSchema>;

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name cannot be empty'),
  price: z
    .union([z.number().min(0, 'Price must be non-negative'), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid non-negative number')])
    .transform((val) => String(val)),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const ListOrdersSchema = z.object({
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(10),
  after: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  before: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

export type ListOrdersInput = z.infer<typeof ListOrdersSchema>;

export const GetOrderSchema = z.object({
  id: z.number().int().positive('Order ID must be a positive integer'),
});

export type GetOrderInput = z.infer<typeof GetOrderSchema>;

export const UpdateOrderStatusSchema = z.object({
  id: z.number().int().positive('Order ID must be a positive integer'),
  status: z.enum(AllowedOrderStatuses, {
    errorMap: () => ({
      message: `Status must be one of: ${AllowedOrderStatuses.join(', ')}`,
    }),
  }),
});

export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
