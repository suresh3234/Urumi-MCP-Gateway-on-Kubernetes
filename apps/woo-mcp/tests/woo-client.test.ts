import { WooCommerceClient, WooCommerceApiError } from '../src/woo-client';
import { AppConfig } from '../src/config';

describe('WooCommerceClient', () => {
  const mockConfig: AppConfig = {
    port: 4001,
    woocommerceUrl: 'http://mock-store:80',
    woocommerceConsumerKey: 'ck_test_key_123',
    woocommerceConsumerSecret: 'cs_test_secret_456',
    apiTimeoutMs: 1000,
    nodeEnv: 'test',
  };

  let client: WooCommerceClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new WooCommerceClient(mockConfig);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('lists products with correct parameters and returns summary', async () => {
    const mockProducts = [
      {
        id: 101,
        name: 'Test Product 1',
        price: '19.99',
        regular_price: '19.99',
        status: 'publish',
        stock_status: 'instock',
        permalink: 'http://mock-store/product/101',
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockProducts,
    } as any);

    const result = await client.listProducts({ page: 1, per_page: 5, search: 'test' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(101);
    expect(result[0].name).toBe('Test Product 1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wc/v3/products?page=1&per_page=5&search=test'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });

  it('creates a simple product successfully', async () => {
    const mockCreated = {
      id: 202,
      name: 'New Gadget',
      price: '99.00',
      regular_price: '99.00',
      status: 'publish',
      stock_status: 'instock',
      permalink: 'http://mock-store/product/202',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCreated,
    } as any);

    const result = await client.createProduct({ name: 'New Gadget', price: '99.00' });
    expect(result.id).toBe(202);
    expect(result.name).toBe('New Gadget');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wc/v3/products'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'New Gadget',
          type: 'simple',
          regular_price: '99.00',
          status: 'publish',
        }),
      })
    );
  });

  it('lists orders with date filters', async () => {
    const mockOrders = [
      {
        id: 301,
        date_created: '2026-05-01T12:00:00',
        status: 'processing',
        total: '55.00',
        currency: 'USD',
        billing: {
          first_name: 'Alice',
          last_name: 'Smith',
          email: 'alice@example.com',
        },
        line_items: [{ id: 1 }],
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOrders,
    } as any);

    const result = await client.listOrders({ page: 1, per_page: 10, after: '2026-01-01' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(301);
    expect(result[0].customer.first_name).toBe('Alice');
  });

  it('retrieves order details by ID', async () => {
    const mockOrder = {
      id: 401,
      date_created: '2026-06-01T10:00:00',
      status: 'completed',
      total: '120.00',
      currency: 'USD',
      payment_method_title: 'Cash on delivery',
      billing: {
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob@example.com',
        phone: '555-1234',
        address_1: '789 Pine St',
        city: 'Denver',
        state: 'CO',
        postcode: '80202',
      },
      line_items: [
        {
          id: 50,
          name: 'Widget A',
          product_id: 10,
          quantity: 2,
          subtotal: '100.00',
          total: '100.00',
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOrder,
    } as any);

    const result = await client.getOrder(401);
    expect(result.id).toBe(401);
    expect(result.status).toBe('completed');
    expect(result.customer.email).toBe('bob@example.com');
    expect(result.line_items).toHaveLength(1);
  });

  it('updates order status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 401, status: 'completed' }),
    } as any);

    const result = await client.updateOrderStatus(401, 'completed');
    expect(result.id).toBe(401);
    expect(result.status).toBe('completed');
  });

  it('throws WooCommerceApiError with AUTH_ERROR on 401 Unauthorized', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Consumer secret is invalid.' }),
    } as any);

    await expect(client.listProducts({})).rejects.toThrow(WooCommerceApiError);
    await expect(client.listProducts({})).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_ERROR',
      message: 'Authentication failed: Invalid WooCommerce API credentials.',
    });
  });

  it('throws WooCommerceApiError with NOT_FOUND on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'Invalid ID.' }),
    } as any);

    await expect(client.getOrder(999)).rejects.toThrow(WooCommerceApiError);
    await expect(client.getOrder(999)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws WooCommerceApiError with TIMEOUT on request abort/timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    global.fetch = jest.fn().mockRejectedValue(abortError);

    await expect(client.listProducts({})).rejects.toThrow(WooCommerceApiError);
    await expect(client.listProducts({})).rejects.toMatchObject({
      statusCode: 408,
      code: 'TIMEOUT',
    });
  });
});
