/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "scranton",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const web = await import("./infra/web.js");
    const github = await import("./infra/github.js");
    const role = github.githubDeployRole();
    return { site: web.site.url, deployRoleArn: role.arn };
  },
});
