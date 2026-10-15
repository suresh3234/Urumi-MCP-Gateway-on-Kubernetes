import { z } from 'zod';

export const CalculateDiscountSchema = z.object({
  price: z.number().positive('Price must be greater than 0'),
  discountPercent: z.number().min(0).max(100, 'Discount percent must be between 0 and 100'),
  taxPercent: z.number().min(0).max(100).optional().default(0),
});

export const ConvertCurrencySchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  from: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'INR']),
  to: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'INR']),
});

export const GenerateSkuSchema = z.object({
  category: z.string().min(2, 'Category must be at least 2 characters'),
  productName: z.string().min(2, 'Product name must be at least 2 characters'),
  variant: z.string().optional(),
});

export const CreateProductDraftSchema = z.object({
  name: z.string().min(1, 'Product name cannot be empty'),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid positive decimal string'),
});
