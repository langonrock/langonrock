# Test certificate

A self-signed certificate and its key, for exercising the TLS path in
`test/tls.test.ts`. It is valid for `localhost` and `127.0.0.1` until 2126.

This key is public on purpose and protects nothing. It exists so the handshake
is a real handshake on every platform CI runs, rather than a mock. Never point
a real server at it.

Regenerate with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout localhost-key.pem -out localhost-cert.pem \
  -days 36500 -subj "/CN=langonrock test/O=langonrock/OU=self-signed test fixture" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
