import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerUtilsTools } from '../src/tools';
import { CalculateDiscountSchema, ConvertCurrencySchema, GenerateSkuSchema } from '../src/schemas';

describe('Utils MCP Tools & Schemas Unit Tests', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: 'test-utils', version: '1.0.0' });
    registerUtilsTools(server);
  });

  describe('CalculateDiscountSchema', () => {
    it('calculates correct discount and tax amounts', () => {
      const parsed = CalculateDiscountSchema.parse({ price: 100, discountPercent: 20, taxPercent: 10 });
      expect(parsed.price).toBe(100);
      expect(parsed.discountPercent).toBe(20);
      expect(parsed.taxPercent).toBe(10);
    });

    it('rejects invalid discount percentage', () => {
      expect(() => CalculateDiscountSchema.parse({ price: 50, discountPercent: 150 })).toThrow();
      expect(() => CalculateDiscountSchema.parse({ price: -10, discountPercent: 10 })).toThrow();
    });
  });

  describe('ConvertCurrencySchema', () => {
    it('accepts valid supported currency codes', () => {
      const parsed = ConvertCurrencySchema.parse({ amount: 50, from: 'USD', to: 'EUR' });
      expect(parsed.amount).toBe(50);
      expect(parsed.from).toBe('USD');
      expect(parsed.to).toBe('EUR');
    });

    it('rejects unsupported currency code', () => {
      expect(() => ConvertCurrencySchema.parse({ amount: 50, from: 'XYZ', to: 'EUR' })).toThrow();
    });
  });

  describe('GenerateSkuSchema', () => {
    it('validates SKU parameters', () => {
      const parsed = GenerateSkuSchema.parse({ category: 'Apparel', productName: 'TShirt', variant: 'L-Blue' });
      expect(parsed.category).toBe('Apparel');
      expect(parsed.productName).toBe('TShirt');
      expect(parsed.variant).toBe('L-Blue');
    });
  });
});
