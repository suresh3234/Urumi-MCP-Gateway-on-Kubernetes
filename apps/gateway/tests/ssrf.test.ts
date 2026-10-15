import { validateUpstreamUrl } from '../src/ssrf-validator';

describe('SSRF Protection Validator', () => {
  it('allows valid internal cluster and public HTTP/HTTPS URLs', () => {
    expect(validateUpstreamUrl('http://woo-mcp:4001/sse').valid).toBe(true);
    expect(validateUpstreamUrl('http://utils-mcp:4002/mcp').valid).toBe(true);
    expect(validateUpstreamUrl('http://notes-mcp.urumi.svc.cluster.local:4003/sse').valid).toBe(true);
    expect(validateUpstreamUrl('https://api.external-mcp.example.com/mcp').valid).toBe(true);
  });

  it('rejects loopback addresses (127.0.0.1, localhost, 0.0.0.0, ::1)', () => {
    expect(validateUpstreamUrl('http://127.0.0.1:8080').valid).toBe(false);
    expect(validateUpstreamUrl('http://localhost:3000').valid).toBe(false);
    expect(validateUpstreamUrl('http://app.localhost:3000').valid).toBe(false);
    expect(validateUpstreamUrl('http://0.0.0.0:80').valid).toBe(false);
    expect(validateUpstreamUrl('http://127.0.0.2:4000').valid).toBe(false);
  });

  it('rejects alternative encodings of loopback (decimal, hex, IPv6, IPv4-mapped IPv6)', () => {
    expect(validateUpstreamUrl('http://2130706433:8080').valid).toBe(false); // 127.0.0.1 decimal
    expect(validateUpstreamUrl('http://0x7f000001:8080').valid).toBe(false); // 127.0.0.1 hex
    expect(validateUpstreamUrl('http://[::1]:8080').valid).toBe(false);      // IPv6 loopback
    expect(validateUpstreamUrl('http://[::]:8080').valid).toBe(false);       // IPv6 unspecified
    expect(validateUpstreamUrl('http://[::ffff:127.0.0.1]:8080').valid).toBe(false); // IPv4-mapped IPv6
  });

  it('rejects cloud metadata and link-local addresses (169.254.169.254, metadata.google.internal, encodings)', () => {
    expect(validateUpstreamUrl('http://169.254.169.254/latest/meta-data').valid).toBe(false);
    expect(validateUpstreamUrl('http://2852039166/latest/meta-data').valid).toBe(false); // 169.254.169.254 decimal
    expect(validateUpstreamUrl('http://0xa9fea9fe/latest/meta-data').valid).toBe(false); // 169.254.169.254 hex
    expect(validateUpstreamUrl('http://metadata.google.internal/computeMetadata/v1/').valid).toBe(false);
    expect(validateUpstreamUrl('http://169.254.1.1:80').valid).toBe(false);
    expect(validateUpstreamUrl('http://[fe80::1]:80').valid).toBe(false); // IPv6 link-local
    expect(validateUpstreamUrl('http://[fd00:ec2::254]:80').valid).toBe(false); // AWS IPv6 metadata
    expect(validateUpstreamUrl('http://100.100.100.200/latest/meta-data').valid).toBe(false); // Alibaba metadata
  });

  it('rejects non-HTTP protocols (file://, ftp://, gopher://)', () => {
    expect(validateUpstreamUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateUpstreamUrl('ftp://example.com/data').valid).toBe(false);
    expect(validateUpstreamUrl('gopher://127.0.0.1:70').valid).toBe(false);
  });

  it('rejects embedded credentials in URL', () => {
    expect(validateUpstreamUrl('http://admin:secret@woo-mcp:4001/sse').valid).toBe(false);
    expect(validateUpstreamUrl('http://user@woo-mcp:4001/sse').valid).toBe(false);
  });
});
