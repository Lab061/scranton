// Static site on S3 + CloudFront. The domain is optional:
//   DOMAIN=scranton.example.com -> production on scranton.example.com,
//                                  other stages on <stage>.scranton.example.com
// A Route 53 hosted zone covering the domain must exist in the deploying account.
const base = process.env.DOMAIN;
const domain = base
  ? $app.stage === "production"
    ? base
    : `${$app.stage}.${base}`
  : undefined;

export const site = new sst.aws.StaticSite("Web", {
  path: "packages/web",
  domain: domain ? { name: domain, dns: sst.aws.dns() } : undefined,
  build: {
    command: "npm run build",
    output: "dist",
  },
  dev: {
    command: "npm run dev",
  },
});
