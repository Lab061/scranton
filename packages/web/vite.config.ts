import { defineConfig, type Plugin } from "vite";

// Pairing links live in localStorage, so the built page may only talk to itself and the
// Paseo relay: an injected script could not send a link anywhere else.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' wss://relay.paseo.sh",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const contentSecurityPolicy = (): Plugin => ({
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    ),
});

export default defineConfig({
  plugins: [contentSecurityPolicy()],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 6000 },
});
