import net from 'net';

/**
 * Server-Side Request Forgery (SSRF) Protection Validator
 * Validates upstream server URLs to prevent attacks against:
 * - Loopback interfaces (127.0.0.0/8, 0.0.0.0/8, ::1, ::, localhost)
 * - Decimal/hex/octal encoded IPv4 loopback & metadata addresses
 * - IPv4-mapped IPv6 representations (::ffff:127.x, ::ffff:7f00:1, ::ffff:169.254.x)
 * - Cloud provider metadata services (AWS/GCP/Azure/DO/Alibaba at 169.254.169.254, 100.100.100.200, metadata.google.internal, fd00:ec2::254)
 * - Link-local ranges (169.254.0.0/16, fe80::/10)
 * - IPv6 Unique Local Addresses (fc00::/7, fd00::/8)
 * - Non-HTTP schemes (file://, ftp://, gopher://)
 * - Embedded credentials (user:pass@host)
 * - Invalid ports and malformed URLs
 */

export interface SsrfValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUpstreamUrl(rawUrl: string): SsrfValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL string is required and cannot be empty.' };
  }

  // Reject embedded credentials or authority spoofing before parsing
  if (rawUrl.includes('@') && !rawUrl.includes('://')) {
    return { valid: false, reason: 'Embedded credentials or malformed URL authority.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Malformed URL format.' };
  }

  // 1. Strict Protocol Enforcement
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Prohibited protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
    };
  }

  // 2. Reject Embedded Credentials
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: 'Embedded user credentials in upstream URLs are strictly prohibited.',
    };
  }

  // 3. Port Range Check
  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return { valid: false, reason: 'Invalid port specification.' };
    }
  }

  const hostname = parsed.hostname.toLowerCase().trim();
  let cleanHost = hostname;
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // 4. Prohibit Localhost and Name-based Loopback
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '[::]' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return {
      valid: false,
      reason: 'Prohibited target: Loopback addresses are forbidden.',
    };
  }

  // 5. Prohibit Cloud Provider Metadata Hostnames & Link-Local Addresses
  const prohibitedHostnames = [
    'metadata.google.internal',
    'metadata.nic.google.internal',
    'instance-data',
    '169.254.169.254',
    '100.100.100.200',
    'fd00:ec2::254',
  ];

  if (
    prohibitedHostnames.includes(cleanHost) ||
    cleanHost.endsWith('.google.internal') ||
    cleanHost.startsWith('169.254.')
  ) {
    return {
      valid: false,
      reason: 'Prohibited target: Cloud provider metadata and link-local addresses are forbidden.',
    };
  }

  // 6. Strict IP Address Validation
  const ipVersion = net.isIP(cleanHost);
  if (ipVersion === 4) {
    const parts = cleanHost.split('.').map((p) => parseInt(p, 10));
    const firstOctet = parts[0];
    const secondOctet = parts[1];

    // Loopback 127.0.0.0/8
    if (firstOctet === 127) {
      return { valid: false, reason: 'Prohibited target: IPv4 loopback range (127.0.0.0/8) is forbidden.' };
    }

    // Unspecified 0.0.0.0/8
    if (firstOctet === 0) {
      return { valid: false, reason: 'Prohibited target: IPv4 unspecified network (0.0.0.0/8) is forbidden.' };
    }

    // Link-local / Cloud metadata 169.254.0.0/16
    if (firstOctet === 169 && secondOctet === 254) {
      return { valid: false, reason: 'Prohibited target: IPv4 link-local/cloud metadata (169.254.0.0/16) is forbidden.' };
    }

    // Broadcast
    if (cleanHost === '255.255.255.255') {
      return { valid: false, reason: 'Prohibited target: Broadcast address is forbidden.' };
    }
  } else if (ipVersion === 6) {
    const lower = cleanHost.toLowerCase();

    // Loopback ::1, unspecified ::
    if (lower === '::1' || lower === '::' || /^0+(:\b0+)*:1$/.test(lower) || /^0+(:\b0+)*$/.test(lower)) {
      return { valid: false, reason: 'Prohibited target: IPv6 loopback is forbidden.' };
    }

    // IPv6 link-local fe80::/10
    if (
      lower.startsWith('fe80:') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return { valid: false, reason: 'Prohibited target: IPv6 link-local (fe80::/10) is forbidden.' };
    }

    // IPv6 unique local address fc00::/7 (fc00:: and fd00::)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return { valid: false, reason: 'Prohibited target: IPv6 unique local address (fc00::/7) is forbidden.' };
    }

    // IPv4-mapped IPv6 (::ffff:127.x.x.x, ::ffff:7f00:1, ::ffff:169.254.x.x, ::ffff:a9fe:a9fe)
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.substring(7);
      if (
        mapped.startsWith('127.') ||
        mapped.startsWith('7f') ||
        mapped.startsWith('169.254.') ||
        mapped.startsWith('a9fe:') ||
        mapped === '0.0.0.0'
      ) {
        return { valid: false, reason: 'Prohibited target: IPv4-mapped IPv6 prohibited target.' };
      }
    }
  }

  return { valid: true };
}
