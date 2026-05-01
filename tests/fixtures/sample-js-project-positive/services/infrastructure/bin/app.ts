#!/usr/bin/env node
/**
 * CDK synthesis entrypoint. This is a short-lived process — crashing on
 * error during synthesis is the desired behavior, since registering an
 * uncaughtException handler that swallows the failure would mask
 * misconfiguration before deploy. The uncaught-exception-no-handler rule
 * should not flag CDK bin scripts.
 */
declare const cdk: {
  App: new () => CdkApp;
  Stack: new (
    scope: CdkApp,
    id: string,
    props: { env: { account: string; region: string } },
  ) => CdkStack;
};

interface CdkApp { synth(): void }
interface CdkStack { readonly stackName: string }

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
if (!account || !region) {
  throw new Error('CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION must be set');
}

const app = new cdk.App();
const stacks: CdkStack[] = [];
stacks.push(new cdk.Stack(app, 'WebsiteStack', { env: { account, region } }));
app.synth();
export { stacks };
