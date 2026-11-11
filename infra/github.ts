// The IAM role GitHub Actions assumes to deploy this stage, through the account's GitHub
// OIDC provider: no access keys anywhere.
//
// Only a workflow job in the matching GitHub environment (`testing` or `production`) of
// this repository gets a token the trust policy accepts. Pull requests, forks and other
// repositories cannot assume it. The environments' branch rules decide which refs may
// deploy, so keep those in place.
//
// The role CI uses is created by a deploy, so the first deploy of each stage runs from a
// laptop with admin credentials; CI takes over after that.
const REPO = process.env.GITHUB_REPO || "Lab061/scranton";

export function githubDeployRole() {
  const account = aws.getCallerIdentityOutput({}).accountId;
  const role = new aws.iam.Role("GithubDeployRole", {
    name: `github-actions-scranton-${$app.stage}`,
    maxSessionDuration: 3600,
    assumeRolePolicy: $jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Federated: $interpolate`arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
          },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": `repo:${REPO}:environment:${$app.stage}`,
            },
          },
        },
      ],
    }),
  });
  // Same as the other Lab061 deploy roles: SST creates and removes arbitrary resource
  // types, so the containment is the trust policy above, not this permission policy.
  new aws.iam.RolePolicyAttachment("GithubDeployRoleAdmin", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
  });
  return role;
}
