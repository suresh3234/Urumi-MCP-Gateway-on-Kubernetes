import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CalculateDiscountSchema, ConvertCurrencySchema, GenerateSkuSchema, CreateProductDraftSchema } from './schemas';

// Static exchange rates against USD baseline
const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.5,
  CAD: 1.38,
  INR: 84.0,
};

export function registerUtilsTools(server: McpServer): void {
  // 1. Calculate Discount
  server.tool(
    'calculate_discount',
    'Calculate discounted price, total savings, and post-tax total for an item.',
    {
      price: z.number().describe('Original price of item'),
      discountPercent: z.number().describe('Discount percentage (0-100)'),
      taxPercent: z.number().optional().describe('Sales tax percentage (0-100)'),
    },
    async (args) => {
      try {
        const validated = CalculateDiscountSchema.parse(args);
        const discountAmount = (validated.price * validated.discountPercent) / 100;
        const discountedPrice = validated.price - discountAmount;
        const taxAmount = (discountedPrice * (validated.taxPercent || 0)) / 100;
        const finalTotal = discountedPrice + taxAmount;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  originalPrice: validated.price,
                  discountPercent: validated.discountPercent,
                  discountAmount: parseFloat(discountAmount.toFixed(2)),
                  discountedPrice: parseFloat(discountedPrice.toFixed(2)),
                  taxPercent: validated.taxPercent || 0,
                  taxAmount: parseFloat(taxAmount.toFixed(2)),
                  finalTotal: parseFloat(finalTotal.toFixed(2)),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 2. Convert Currency
  server.tool(
    'convert_currency',
    'Convert an amount between supported fiat currencies (USD, EUR, GBP, JPY, CAD, INR).',
    {
      amount: z.number().describe('Amount in source currency'),
      from: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'INR']).describe('Source currency code'),
      to: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'INR']).describe('Target currency code'),
    },
    async (args) => {
      try {
        const validated = ConvertCurrencySchema.parse(args);
        const amountInUSD = validated.amount / EXCHANGE_RATES[validated.from];
        const convertedAmount = amountInUSD * EXCHANGE_RATES[validated.to];

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  originalAmount: validated.amount,
                  fromCurrency: validated.from,
                  targetCurrency: validated.to,
                  convertedAmount: parseFloat(convertedAmount.toFixed(2)),
                  rate: parseFloat((EXCHANGE_RATES[validated.to] / EXCHANGE_RATES[validated.from]).toFixed(4)),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 3. Generate SKU
  server.tool(
    'generate_sku',
    'Generate a standardized, unique product SKU code based on category, name, and variant.',
    {
      category: z.string().describe('Product category (e.g. APPAREL, ELECTRONICS)'),
      productName: z.string().describe('Product title or name'),
      variant: z.string().optional().describe('Variant attribute (e.g. XL-RED, 64GB)'),
    },
    async (args) => {
      try {
        const validated = GenerateSkuSchema.parse(args);
        const catPrefix = validated.category.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
        const nameCode = validated.productName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, '0');
        const variantSuffix = validated.variant ? `-${validated.variant.toUpperCase().replace(/[^A-Z0-9]/g, '')}` : '';
        const randomHex = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');

        const sku = `${catPrefix}-${nameCode}${variantSuffix}-${randomHex}`;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  sku,
                  category: validated.category,
                  productName: validated.productName,
                  variant: validated.variant || null,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // 4. Create Product (Mock draft tool to intentionally test collision handling with woo-mcp)
  server.tool(
    'create_product',
    'Utility draft tool for validating and preparing offline product drafts (collides with woo-mcp).',
    {
      name: z.string().describe('Product name'),
      price: z.string().describe('Product price'),
    },
    async (args) => {
      try {
        const validated = CreateProductDraftSchema.parse(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  draftId: `draft_${Date.now()}`,
                  name: validated.name,
                  price: validated.price,
                  source: 'utils-mcp',
                  isDraft: true,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true,
        };
      }
    }
  );
}
