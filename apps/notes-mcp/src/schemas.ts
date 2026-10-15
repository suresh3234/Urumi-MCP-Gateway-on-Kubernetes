import { z } from 'zod';

export const AddOrderNoteSchema = z.object({
  orderId: z.number().int().positive('Order ID must be a positive integer'),
  note: z.string().min(1, 'Note content cannot be empty'),
  isCustomerNote: z.boolean().optional().default(false),
  author: z.string().optional().default('AI Agent'),
});

export const ListOrderNotesSchema = z.object({
  orderId: z.number().int().positive('Order ID must be a positive integer'),
});

export const SearchNotesSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
});

export const DeleteOrderNoteSchema = z.object({
  noteId: z.string().min(1, 'Note ID cannot be empty'),
});
