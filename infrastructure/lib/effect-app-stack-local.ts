import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class EffectAppStackLocal extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create log group
    const logGroup = new logs.LogGroup(this, 'EffectAppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a simple Lambda function for testing
    const lambdaFunction = new lambda.Function(this, 'EffectAppFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Event:', JSON.stringify(event, null, 2));
          
          const response = {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              message: 'Hello from LocalStack!',
              timestamp: new Date().toISOString(),
              path: event.path,
              method: event.httpMethod
            })
          };
          
          return response;
        };
      `),
      logGroup,
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'EffectAppApi', {
      restApiName: 'Effect App Test API',
      description: 'Test API for Effect App in LocalStack',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Create Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);

    // Add routes
    api.root.addMethod('GET', lambdaIntegration);
    api.root.addMethod('POST', lambdaIntegration);
    
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', lambdaIntegration);

    // Output the API Gateway URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      value: lambdaFunction.functionName,
      description: 'Lambda Function Name',
    });
  }
}
