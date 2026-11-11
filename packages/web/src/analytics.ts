// Product analytics (PostHog). Anonymous and explicit only: no autocapture, no session
// recording, no surveys, no feature flags, no scripts loaded from PostHog's CDN.
//
// Never send anything the office displays: agent names, prompts, workspace or project
// names, hostnames, paths, machine labels or pairing links. Send counts and categories.
//
// Builds without VITE_POSTHOG_KEY (forks, self-hosted copies, local dev) send nothing.
import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  "https://us.i.posthog.com";

let enabled = false;

export function initAnalytics() {
  if (!KEY) {
    if (import.meta.env.DEV)
      console.error(
        "VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured"
      );
    return;
  }
  posthog.init(KEY, {
    api_host: HOST,
    persistence: "localStorage",
    person_profiles: "identified_only",
    respect_dnt: true,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    rageclick: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false, // raw errors can carry agent text; report categories instead
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_product_tours: true,
    disable_conversations: true,
    advanced_disable_flags: true,
    disable_external_dependency_loading: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    // The page never puts private data in the URL, but strip query and hash anyway.
    before_send: (event) => {
      if (event?.properties) {
        for (const k of [
          "$current_url",
          "$referrer",
          "$prev_pageview_pathname",
        ]) {
          const v = event.properties[k];
          if (typeof v === "string")
            event.properties[k] = v.replace(/[?#].*$/, "");
        }
      }
      return event;
    },
  });
  enabled = true;
}

type Props = Record<string, string | number | boolean | null>;

export function track(event: string, props?: Props) {
  if (enabled) posthog.capture(event, props);
}

/** Properties sent with every event: whether the page shows demo or live data, and how much. */
export function setContext(props: Props) {
  if (enabled) posthog.register(props);
}

/** Size buckets, so counts never fingerprint a setup. */
export function bucket(n: number): string {
  if (n === 0) return "0";
  if (n <= 5) return "1-5";
  if (n <= 20) return "6-20";
  if (n <= 50) return "21-50";
  return "50+";
}

/** Report a failure by category only; the original message may contain private text. */
export function trackError(area: string, category: string) {
  if (!enabled) return;
  posthog.captureException(new Error(`${area}: ${category}`), {
    area,
    category,
  });
}
