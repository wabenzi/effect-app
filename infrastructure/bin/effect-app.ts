#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EffectAppStack } from '../lib/effect-app-stack.ts';

const app = new cdk.App();

new EffectAppStack(app, 'EffectAppStack-v2', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-2'
  },
  description: 'Effect-TS HTTP API deployed on AWS Fargate with API Gateway and ALB'
});
