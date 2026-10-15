import {
  ListProductsSchema,
  CreateProductSchema,
  ListOrdersSchema,
  GetOrderSchema,
  UpdateOrderStatusSchema,
  AllowedOrderStatuses,
} from '../src/schemas';

describe('Zod Validation Schemas', () => {
  describe('ListProductsSchema', () => {
    it('applies default pagination values', () => {
      const parsed = ListProductsSchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.per_page).toBe(10);
      expect(parsed.search).toBeUndefined();
    });

    it('accepts valid custom pagination and search keyword', () => {
      const parsed = ListProductsSchema.parse({
        page: 2,
        per_page: 25,
        search: 'shirt',
      });
      expect(parsed.page).toBe(2);
      expect(parsed.per_page).toBe(25);
      expect(parsed.search).toBe('shirt');
    });

    it('rejects invalid page and per_page numbers', () => {
      expect(() => ListProductsSchema.parse({ page: 0 })).toThrow();
      expect(() => ListProductsSchema.parse({ page: -1 })).toThrow();
      expect(() => ListProductsSchema.parse({ per_page: 150 })).toThrow();
      expect(() => ListProductsSchema.parse({ per_page: 0 })).toThrow();
    });
  });

  describe('CreateProductSchema', () => {
    it('accepts valid name and numerical price', () => {
      const parsed = CreateProductSchema.parse({
        name: 'MCP Coffee Mug',
        price: 14.99,
      });
      expect(parsed.name).toBe('MCP Coffee Mug');
      expect(parsed.price).toBe('14.99');
    });

    it('accepts valid name and string price', () => {
      const parsed = CreateProductSchema.parse({
        name: 'MCP Hoodie',
        price: '45.00',
      });
      expect(parsed.name).toBe('MCP Hoodie');
      expect(parsed.price).toBe('45.00');
    });

    it('rejects empty product name', () => {
      expect(() => CreateProductSchema.parse({ name: '', price: 10 })).toThrow(/Product name cannot be empty/);
      expect(() => CreateProductSchema.parse({ name: '   ', price: 10 })).toThrow();
    });

    it('rejects negative or invalid price values', () => {
      expect(() => CreateProductSchema.parse({ name: 'Item', price: -5 })).toThrow();
      expect(() => CreateProductSchema.parse({ name: 'Item', price: 'invalid' })).toThrow();
    });
  });

  describe('ListOrdersSchema', () => {
    it('applies default pagination values', () => {
      const parsed = ListOrdersSchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.per_page).toBe(10);
    });

    it('accepts valid ISO date filters', () => {
      const parsed = ListOrdersSchema.parse({
        after: '2026-01-01',
        before: '2026-12-31',
      });
      expect(parsed.after).toBe('2026-01-01');
      expect(parsed.before).toBe('2026-12-31');
    });
  });

  describe('GetOrderSchema', () => {
    it('accepts valid positive integer order ID', () => {
      const parsed = GetOrderSchema.parse({ id: 42 });
      expect(parsed.id).toBe(42);
    });

    it('rejects non-positive order ID', () => {
      expect(() => GetOrderSchema.parse({ id: 0 })).toThrow();
      expect(() => GetOrderSchema.parse({ id: -10 })).toThrow();
      expect(() => GetOrderSchema.parse({ id: 'abc' })).toThrow();
    });
  });

  describe('UpdateOrderStatusSchema', () => {
    it.each(AllowedOrderStatuses)('accepts allowed status: %s', (status) => {
      const parsed = UpdateOrderStatusSchema.parse({ id: 10, status });
      expect(parsed.status).toBe(status);
    });

    it('rejects arbitrary or unknown order statuses', () => {
      expect(() => UpdateOrderStatusSchema.parse({ id: 10, status: 'shipped' })).toThrow();
      expect(() => UpdateOrderStatusSchema.parse({ id: 10, status: 'random_status' })).toThrow();
      expect(() => UpdateOrderStatusSchema.parse({ id: 10, status: '' })).toThrow();
    });
  });
});
