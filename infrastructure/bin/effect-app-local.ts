#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EffectAppStackLocal } from '../lib/effect-app-stack-local.ts';

const app = new cdk.App();
new EffectAppStackLocal(app, 'EffectAppStackLocal', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '000000000000',
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
