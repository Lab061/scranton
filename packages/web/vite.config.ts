import { defineConfig, loadEnv, type Plugin } from "vite";

// Pairing links live in localStorage, so the built page may only talk to itself and the
// Paseo relay: an injected script could not send a link anywhere else.
// PostHog's API host is added only when analytics are configured for the build.
const csp = (analyticsHost: string | null) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self' wss://relay.paseo.sh${analyticsHost ? " " + analyticsHost : ""}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");

const contentSecurityPolicy = (analyticsHost: string | null): Plugin => ({
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace(
      "<head>",
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp(analyticsHost)}">`
    ),
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const analyticsHost = env.VITE_POSTHOG_KEY
    ? new URL(env.VITE_POSTHOG_HOST || "https://us.i.posthog.com").origin
    : null;
  return {
    plugins: [contentSecurityPolicy(analyticsHost)],
    build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 6000 },
  };
});
