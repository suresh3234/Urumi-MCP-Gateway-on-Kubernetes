import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  woocommerceUrl: string;
  woocommerceConsumerKey: string;
  woocommerceConsumerSecret: string;
  apiTimeoutMs: number;
  nodeEnv: string;
}

export function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT || '4001', 10);
  const woocommerceUrl = (process.env.WOOCOMMERCE_URL || 'http://wordpress:80').replace(/\/+$/, '');
  const woocommerceConsumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY || '';
  const woocommerceConsumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET || '';
  const apiTimeoutMs = parseInt(process.env.WOOCOMMERCE_API_TIMEOUT_MS || '10000', 10);
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    port,
    woocommerceUrl,
    woocommerceConsumerKey,
    woocommerceConsumerSecret,
    apiTimeoutMs,
    nodeEnv,
  };
}
