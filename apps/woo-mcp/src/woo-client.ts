import { AppConfig } from './config';

export interface WooProductSummary {
  id: number;
  name: string;
  price: string;
  regular_price?: string;
  status: string;
  stock_status: string;
  permalink?: string;
}

export interface WooOrderSummary {
  id: number;
  date_created: string;
  status: string;
  total: string;
  currency: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
  };
  line_items_count?: number;
}

export class WooCommerceApiError extends Error {
  public statusCode?: number;
  public code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = 'WooCommerceApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class WooCommerceClient {
  private baseUrl: string;
  private consumerKey: string;
  private consumerSecret: string;
  private timeoutMs: number;

  constructor(config: AppConfig) {
    this.baseUrl = config.woocommerceUrl;
    this.consumerKey = config.woocommerceConsumerKey;
    this.consumerSecret = config.woocommerceConsumerSecret;
    this.timeoutMs = config.apiTimeoutMs;
  }

  private getAuthHeader(): string {
    const token = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    return `Basic ${token}`;
  }

  public async request<T>(endpoint: string, options: { method?: string; params?: Record<string, any>; body?: any } = {}): Promise<T> {
    const method = options.method || 'GET';
    const url = new URL(`${this.baseUrl}/wp-json/wc/v3/${endpoint.replace(/^\/+/, '')}`);

    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': 'Urumi-MCP-Gateway/1.0',
        'Authorization': this.getAuthHeader(),
        'X-Forwarded-Proto': 'https',
      };

      if (options.body) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorData: any = {};
        try {
          errorData = await response.json();
        } catch {
          // ignore parsing error
        }

        const message = errorData.message || `WooCommerce API request failed with HTTP ${response.status} (${response.statusText})`;
        const code = errorData.code || `HTTP_${response.status}`;

        if (response.status === 401 || response.status === 403) {
          throw new WooCommerceApiError('Authentication failed: Invalid WooCommerce API credentials.', response.status, 'AUTH_ERROR');
        } else if (response.status === 404) {
          throw new WooCommerceApiError(`Resource not found: ${message}`, 404, 'NOT_FOUND');
        } else if (response.status === 429) {
          throw new WooCommerceApiError('Rate limit exceeded on WooCommerce store.', 429, 'RATE_LIMIT');
        } else {
          throw new WooCommerceApiError(message, response.status, code);
        }
      }

      return (await response.json()) as T;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        throw new WooCommerceApiError(`WooCommerce API request timed out after ${this.timeoutMs}ms.`, 408, 'TIMEOUT');
      }

      if (err instanceof WooCommerceApiError) {
        throw err;
      }

      throw new WooCommerceApiError(`Network error communicating with WooCommerce: ${err.message || 'Unknown error'}`, 500, 'NETWORK_ERROR');
    }
  }

  public async listProducts(params: { page?: number; per_page?: number; search?: string }): Promise<WooProductSummary[]> {
    const raw = await this.request<any[]>('products', {
      method: 'GET',
      params: {
        page: params.page || 1,
        per_page: params.per_page || 10,
        search: params.search,
      },
    });

    return raw.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      regular_price: p.regular_price,
      status: p.status,
      stock_status: p.stock_status,
      permalink: p.permalink,
    }));
  }

  public async createProduct(data: { name: string; price: string }): Promise<WooProductSummary> {
    const raw = await this.request<any>('products', {
      method: 'POST',
      body: {
        name: data.name,
        type: 'simple',
        regular_price: data.price,
        status: 'publish',
      },
    });

    return {
      id: raw.id,
      name: raw.name,
      price: raw.price,
      regular_price: raw.regular_price,
      status: raw.status,
      stock_status: raw.stock_status,
      permalink: raw.permalink,
    };
  }

  public async listOrders(params: { page?: number; per_page?: number; after?: string; before?: string }): Promise<WooOrderSummary[]> {
    const raw = await this.request<any[]>('orders', {
      method: 'GET',
      params: {
        page: params.page || 1,
        per_page: params.per_page || 10,
        after: params.after,
        before: params.before,
      },
    });

    return raw.map((o) => ({
      id: o.id,
      date_created: o.date_created,
      status: o.status,
      total: o.total,
      currency: o.currency,
      customer: {
        first_name: o.billing?.first_name || '',
        last_name: o.billing?.last_name || '',
        email: o.billing?.email || '',
      },
      line_items_count: o.line_items?.length || 0,
    }));
  }

  public async getOrder(id: number): Promise<any> {
    const raw = await this.request<any>(`orders/${id}`, {
      method: 'GET',
    });

    return {
      id: raw.id,
      date_created: raw.date_created,
      status: raw.status,
      total: raw.total,
      currency: raw.currency,
      payment_method_title: raw.payment_method_title,
      customer: {
        first_name: raw.billing?.first_name || '',
        last_name: raw.billing?.last_name || '',
        email: raw.billing?.email || '',
        phone: raw.billing?.phone || '',
        address: `${raw.billing?.address_1 || ''}, ${raw.billing?.city || ''} ${raw.billing?.state || ''} ${raw.billing?.postcode || ''}`.trim(),
      },
      line_items: (raw.line_items || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        product_id: item.product_id,
        quantity: item.quantity,
        subtotal: item.subtotal,
        total: item.total,
      })),
    };
  }

  public async updateOrderStatus(id: number, status: string): Promise<{ id: number; status: string; previous_status?: string }> {
    const raw = await this.request<any>(`orders/${id}`, {
      method: 'PUT',
      body: {
        status,
      },
    });

    return {
      id: raw.id,
      status: raw.status,
    };
  }
}
