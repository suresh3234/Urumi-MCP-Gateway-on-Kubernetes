import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WooCommerceClient, WooCommerceApiError } from './woo-client';
import { AllowedOrderStatuses } from './schemas';

export function registerWooCommerceTools(server: McpServer, wooClient: WooCommerceClient): void {
  // 1. list_products
  server.tool(
    'list_products',
    'List products in the WooCommerce store with pagination and optional search filter.',
    {
      page: z.number().int().positive().optional().describe('Page number for pagination (defaults to 1)'),
      per_page: z.number().int().min(1).max(100).optional().describe('Number of items per page (1-100, defaults to 10)'),
      search: z.string().trim().optional().describe('Optional search keyword to filter products by title or description'),
    },
    async (args) => {
      try {
        const products = await wooClient.listProducts(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: products.length,
                  page: args.page || 1,
                  per_page: args.per_page || 10,
                  products,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleToolError(err, 'list_products');
      }
    }
  );

  // 2. create_product
  server.tool(
    'create_product',
    'Create a new simple product in WooCommerce with a name and price.',
    {
      name: z.string().trim().min(1, 'Product name cannot be empty').describe('The name / title of the product'),
      price: z
        .union([z.number().min(0, 'Price must be non-negative'), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid non-negative number')])
        .describe('Regular price for the product (e.g. 29.99 or "29.99")'),
    },
    async (args) => {
      try {
        const priceStr = String(args.price);
        const product = await wooClient.createProduct({
          name: args.name,
          price: priceStr,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: 'Product created successfully',
                  product,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleToolError(err, 'create_product');
      }
    }
  );

  // 3. list_orders
  server.tool(
    'list_orders',
    'List orders in the WooCommerce store with pagination and optional ISO date filters.',
    {
      page: z.number().int().positive().optional().describe('Page number for pagination (defaults to 1)'),
      per_page: z.number().int().min(1).max(100).optional().describe('Number of items per page (1-100, defaults to 10)'),
      after: z.string().optional().describe('Limit response to resources published after a given ISO-8601 compliant date (e.g. 2026-01-01T00:00:00Z or 2026-01-01)'),
      before: z.string().optional().describe('Limit response to resources published before a given ISO-8601 compliant date (e.g. 2026-12-31T23:59:59Z or 2026-12-31)'),
    },
    async (args) => {
      try {
        const orders = await wooClient.listOrders(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: orders.length,
                  page: args.page || 1,
                  per_page: args.per_page || 10,
                  orders,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleToolError(err, 'list_orders');
      }
    }
  );

  // 4. get_order
  server.tool(
    'get_order',
    'Retrieve complete details of a specific WooCommerce order by ID.',
    {
      id: z.number().int().positive().describe('The unique integer ID of the order'),
    },
    async (args) => {
      try {
        const order = await wooClient.getOrder(args.id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(order, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return handleToolError(err, `get_order (id: ${args.id})`);
      }
    }
  );

  // 5. update_order_status
  server.tool(
    'update_order_status',
    `Update the status of an existing WooCommerce order. Allowed statuses: ${AllowedOrderStatuses.join(', ')}`,
    {
      id: z.number().int().positive().describe('The unique integer ID of the order to update'),
      status: z.enum(AllowedOrderStatuses).describe(`New order status (${AllowedOrderStatuses.join(', ')})`),
    },
    async (args) => {
      try {
        const result = await wooClient.updateOrderStatus(args.id, args.status);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Order #${args.id} status updated to '${args.status}'`,
                  order: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return handleToolError(err, `update_order_status (id: ${args.id})`);
      }
    }
  );
}

function handleToolError(err: any, context: string) {
  const isWooError = err instanceof WooCommerceApiError;
  const status = isWooError ? err.statusCode : 500;
  const code = isWooError ? err.code : 'INTERNAL_ERROR';
  const message = isWooError ? err.message : (err.message || 'An unexpected error occurred.');

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: true,
            context,
            statusCode: status,
            code,
            message,
          },
          null,
          2
        ),
      },
    ],
  };
}
