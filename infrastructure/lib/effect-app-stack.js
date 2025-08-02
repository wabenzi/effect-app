"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EffectAppStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const ecsPatterns = require("aws-cdk-lib/aws-ecs-patterns");
const apigatewayv2 = require("aws-cdk-lib/aws-apigatewayv2");
const apigatewayv2Integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const logs = require("aws-cdk-lib/aws-logs");
class EffectAppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC for the infrastructure
        const vpc = new ec2.Vpc(this, 'EffectAppVpc', {
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'PublicSubnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'PrivateSubnet',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            ],
        });
        // Create ECS Cluster
        const cluster = new ecs.Cluster(this, 'EffectAppCluster', {
            vpc,
            clusterName: 'effect-app-cluster',
            containerInsights: true,
        });
        // Create CloudWatch Log Group
        const logGroup = new logs.LogGroup(this, 'EffectAppLogGroup', {
            logGroupName: '/ecs/effect-app-fargate',
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Create Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'EffectAppTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
            family: 'effect-app-task',
        });
        // Add container to task definition
        const container = taskDefinition.addContainer('EffectAppContainer', {
            image: ecs.ContainerImage.fromRegistry('822812326070.dkr.ecr.us-west-2.amazonaws.com/effect-app:latest'),
            memoryLimitMiB: 512,
            cpu: 256,
            environment: {
                NODE_ENV: 'production',
                PORT: '3000',
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'effect-app',
                logGroup: logGroup,
            }),
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60),
            },
        });
        // Add port mapping
        container.addPortMappings({
            containerPort: 3000,
            protocol: ecs.Protocol.TCP,
        });
        // Create Fargate Service with Application Load Balancer
        const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'EffectAppService', {
            cluster,
            taskDefinition,
            serviceName: 'effect-app-service',
            publicLoadBalancer: true,
            memoryLimitMiB: 512,
            cpu: 256,
            desiredCount: 2,
            listenerPort: 80,
            healthCheckGracePeriod: cdk.Duration.seconds(120),
            domainZone: undefined,
            platformVersion: ecs.FargatePlatformVersion.LATEST,
        });
        // Configure health check for the target group
        fargateService.targetGroup.configureHealthCheck({
            path: '/health',
            port: '3000',
            healthyHttpCodes: '200',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3,
        });
        // Configure service auto scaling
        const scaling = fargateService.service.autoScaleTaskCount({
            minCapacity: 1,
            maxCapacity: 10,
        });
        scaling.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });
        scaling.scaleOnMemoryUtilization('MemoryScaling', {
            targetUtilizationPercent: 80,
            scaleInCooldown: cdk.Duration.seconds(300),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });
        // Create VPC Link for API Gateway v2
        const vpcLink = new apigatewayv2.VpcLink(this, 'EffectAppVpcLink', {
            vpc,
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            vpcLinkName: 'effect-app-vpc-link',
        });
        // Create HTTP API Gateway v2
        const httpApi = new apigatewayv2.HttpApi(this, 'EffectAppHttpApi', {
            apiName: 'effect-app-api',
            description: 'Effect-TS HTTP API Gateway',
            corsPreflight: {
                allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token', 'Cookie'],
                allowMethods: [
                    apigatewayv2.CorsHttpMethod.GET,
                    apigatewayv2.CorsHttpMethod.POST,
                    apigatewayv2.CorsHttpMethod.PUT,
                    apigatewayv2.CorsHttpMethod.PATCH,
                    apigatewayv2.CorsHttpMethod.DELETE,
                    apigatewayv2.CorsHttpMethod.OPTIONS,
                ],
                allowOrigins: ['*'],
                maxAge: cdk.Duration.days(1),
            },
        });
        // Create ALB Integration for HTTP API
        const albIntegration = new apigatewayv2Integrations.HttpAlbIntegration('AlbIntegration', fargateService.listener, {
            vpcLink,
            parameterMapping: new apigatewayv2.ParameterMapping()
                .appendHeader('x-forwarded-for', apigatewayv2.MappingValue.contextVariable('identity.sourceIp'))
                .appendHeader('x-forwarded-proto', apigatewayv2.MappingValue.custom('https')),
        });
        // Add routes to HTTP API
        httpApi.addRoutes({
            path: '/{proxy+}',
            methods: [
                apigatewayv2.HttpMethod.GET,
                apigatewayv2.HttpMethod.POST,
                apigatewayv2.HttpMethod.PUT,
                apigatewayv2.HttpMethod.PATCH,
                apigatewayv2.HttpMethod.DELETE,
            ],
            integration: albIntegration,
        });
        // Add default route for root path
        httpApi.addRoutes({
            path: '/',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: albIntegration,
        });
        // Create deployment stage
        httpApi.addStage('prod', {
            autoDeploy: true,
            description: 'Production stage for Effect-TS API',
            throttle: {
                rateLimit: 1000,
                burstLimit: 2000,
            },
        });
        // Output important information
        new cdk.CfnOutput(this, 'LoadBalancerDNS', {
            value: fargateService.loadBalancer.loadBalancerDnsName,
            description: 'DNS name of the load balancer - direct access',
        });
        new cdk.CfnOutput(this, 'LoadBalancerUrl', {
            value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
            description: 'Direct URL to access your API via Load Balancer',
        });
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: httpApi.apiEndpoint,
            description: 'API Gateway endpoint URL - recommended for production',
        });
        new cdk.CfnOutput(this, 'ApiGatewayId', {
            value: httpApi.apiId,
            description: 'API Gateway ID',
        });
        new cdk.CfnOutput(this, 'HealthCheckUrl', {
            value: `${httpApi.apiEndpoint}/health`,
            description: 'Health check endpoint via API Gateway',
        });
        new cdk.CfnOutput(this, 'ClusterName', {
            value: cluster.clusterName,
            description: 'ECS Cluster name',
        });
        new cdk.CfnOutput(this, 'ServiceName', {
            value: fargateService.service.serviceName,
            description: 'ECS Service name',
        });
        new cdk.CfnOutput(this, 'TaskDefinitionArn', {
            value: taskDefinition.taskDefinitionArn,
            description: 'Task Definition ARN',
        });
        new cdk.CfnOutput(this, 'LogGroupName', {
            value: logGroup.logGroupName,
            description: 'CloudWatch Log Group name',
        });
        new cdk.CfnOutput(this, 'VpcId', {
            value: vpc.vpcId,
            description: 'VPC ID',
        });
        new cdk.CfnOutput(this, 'SecurityGroupId', {
            value: fargateService.service.connections.securityGroups[0].securityGroupId,
            description: 'Security Group ID for ECS service',
        });
    }
}
exports.EffectAppStack = EffectAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWZmZWN0LWFwcC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImVmZmVjdC1hcHAtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNERBQTREO0FBQzVELDZEQUE2RDtBQUM3RCxzRkFBc0Y7QUFDdEYsNkNBQTZDO0FBSTdDLE1BQWEsY0FBZSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzNDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsb0NBQW9DO1FBQ3BDLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzVDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUM7WUFDZCxtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGNBQWM7b0JBQ3BCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxlQUFlO29CQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7aUJBQy9DO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUN4RCxHQUFHO1lBQ0gsV0FBVyxFQUFFLG9CQUFvQjtZQUNqQyxpQkFBaUIsRUFBRSxJQUFJO1NBQ3hCLENBQUMsQ0FBQztRQUVILDhCQUE4QjtRQUM5QixNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzVELFlBQVksRUFBRSx5QkFBeUI7WUFDdkMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtZQUN0QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILHlCQUF5QjtRQUN6QixNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDN0UsY0FBYyxFQUFFLEdBQUc7WUFDbkIsR0FBRyxFQUFFLEdBQUc7WUFDUixNQUFNLEVBQUUsaUJBQWlCO1NBQzFCLENBQUMsQ0FBQztRQUVILG1DQUFtQztRQUNuQyxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsWUFBWSxDQUFDLG9CQUFvQixFQUFFO1lBQ2xFLEtBQUssRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxnRUFBZ0UsQ0FBQztZQUN4RyxjQUFjLEVBQUUsR0FBRztZQUNuQixHQUFHLEVBQUUsR0FBRztZQUNSLFdBQVcsRUFBRTtnQkFDWCxRQUFRLEVBQUUsWUFBWTtnQkFDdEIsSUFBSSxFQUFFLE1BQU07YUFDYjtZQUNELE9BQU8sRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQztnQkFDOUIsWUFBWSxFQUFFLFlBQVk7Z0JBQzFCLFFBQVEsRUFBRSxRQUFRO2FBQ25CLENBQUM7WUFDRixXQUFXLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLENBQUMsV0FBVyxFQUFFLGdEQUFnRCxDQUFDO2dCQUN4RSxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUNsQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUNoQyxPQUFPLEVBQUUsQ0FBQztnQkFDVixXQUFXLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2FBQ3RDO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsbUJBQW1CO1FBQ25CLFNBQVMsQ0FBQyxlQUFlLENBQUM7WUFDeEIsYUFBYSxFQUFFLElBQUk7WUFDbkIsUUFBUSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsR0FBRztTQUMzQixDQUFDLENBQUM7UUFFSCx3REFBd0Q7UUFDeEQsTUFBTSxjQUFjLEdBQUcsSUFBSSxXQUFXLENBQUMscUNBQXFDLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ3JHLE9BQU87WUFDUCxjQUFjO1lBQ2QsV0FBVyxFQUFFLG9CQUFvQjtZQUNqQyxrQkFBa0IsRUFBRSxJQUFJO1lBQ3hCLGNBQWMsRUFBRSxHQUFHO1lBQ25CLEdBQUcsRUFBRSxHQUFHO1lBQ1IsWUFBWSxFQUFFLENBQUM7WUFDZixZQUFZLEVBQUUsRUFBRTtZQUNoQixzQkFBc0IsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDakQsVUFBVSxFQUFFLFNBQVM7WUFDckIsZUFBZSxFQUFFLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNO1NBQ25ELENBQUMsQ0FBQztRQUVILDhDQUE4QztRQUM5QyxjQUFjLENBQUMsV0FBVyxDQUFDLG9CQUFvQixDQUFDO1lBQzlDLElBQUksRUFBRSxTQUFTO1lBQ2YsSUFBSSxFQUFFLE1BQU07WUFDWixnQkFBZ0IsRUFBRSxLQUFLO1lBQ3ZCLFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDbEMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUNoQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ3hCLHVCQUF1QixFQUFFLENBQUM7U0FDM0IsQ0FBQyxDQUFDO1FBRUgsaUNBQWlDO1FBQ2pDLE1BQU0sT0FBTyxHQUFHLGNBQWMsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUM7WUFDeEQsV0FBVyxFQUFFLENBQUM7WUFDZCxXQUFXLEVBQUUsRUFBRTtTQUNoQixDQUFDLENBQUM7UUFFSCxPQUFPLENBQUMscUJBQXFCLENBQUMsWUFBWSxFQUFFO1lBQzFDLHdCQUF3QixFQUFFLEVBQUU7WUFDNUIsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUMxQyxnQkFBZ0IsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsT0FBTyxDQUFDLHdCQUF3QixDQUFDLGVBQWUsRUFBRTtZQUNoRCx3QkFBd0IsRUFBRSxFQUFFO1lBQzVCLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDMUMsZ0JBQWdCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1NBQzNDLENBQUMsQ0FBQztRQUVILHFDQUFxQztRQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ2pFLEdBQUc7WUFDSCxPQUFPLEVBQUUsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsRUFBRTtZQUMzRCxXQUFXLEVBQUUscUJBQXFCO1NBQ25DLENBQUMsQ0FBQztRQUVILDZCQUE2QjtRQUM3QixNQUFNLE9BQU8sR0FBRyxJQUFJLFlBQVksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ2pFLE9BQU8sRUFBRSxnQkFBZ0I7WUFDekIsV0FBVyxFQUFFLDRCQUE0QjtZQUN6QyxhQUFhLEVBQUU7Z0JBQ2IsWUFBWSxFQUFFLENBQUMsY0FBYyxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLHNCQUFzQixFQUFFLFFBQVEsQ0FBQztnQkFDNUcsWUFBWSxFQUFFO29CQUNaLFlBQVksQ0FBQyxjQUFjLENBQUMsR0FBRztvQkFDL0IsWUFBWSxDQUFDLGNBQWMsQ0FBQyxJQUFJO29CQUNoQyxZQUFZLENBQUMsY0FBYyxDQUFDLEdBQUc7b0JBQy9CLFlBQVksQ0FBQyxjQUFjLENBQUMsS0FBSztvQkFDakMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxNQUFNO29CQUNsQyxZQUFZLENBQUMsY0FBYyxDQUFDLE9BQU87aUJBQ3BDO2dCQUNELFlBQVksRUFBRSxDQUFDLEdBQUcsQ0FBQztnQkFDbkIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQzthQUM3QjtTQUNGLENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxNQUFNLGNBQWMsR0FBRyxJQUFJLHdCQUF3QixDQUFDLGtCQUFrQixDQUFDLGdCQUFnQixFQUNyRixjQUFjLENBQUMsUUFBUSxFQUN2QjtZQUNFLE9BQU87WUFDUCxnQkFBZ0IsRUFBRSxJQUFJLFlBQVksQ0FBQyxnQkFBZ0IsRUFBRTtpQkFDbEQsWUFBWSxDQUFDLGlCQUFpQixFQUFFLFlBQVksQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDLG1CQUFtQixDQUFDLENBQUM7aUJBQy9GLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSxZQUFZLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztTQUNoRixDQUNGLENBQUM7UUFFRix5QkFBeUI7UUFDekIsT0FBTyxDQUFDLFNBQVMsQ0FBQztZQUNoQixJQUFJLEVBQUUsV0FBVztZQUNqQixPQUFPLEVBQUU7Z0JBQ1AsWUFBWSxDQUFDLFVBQVUsQ0FBQyxHQUFHO2dCQUMzQixZQUFZLENBQUMsVUFBVSxDQUFDLElBQUk7Z0JBQzVCLFlBQVksQ0FBQyxVQUFVLENBQUMsR0FBRztnQkFDM0IsWUFBWSxDQUFDLFVBQVUsQ0FBQyxLQUFLO2dCQUM3QixZQUFZLENBQUMsVUFBVSxDQUFDLE1BQU07YUFDL0I7WUFDRCxXQUFXLEVBQUUsY0FBYztTQUM1QixDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsT0FBTyxDQUFDLFNBQVMsQ0FBQztZQUNoQixJQUFJLEVBQUUsR0FBRztZQUNULE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDO1lBQ3RDLFdBQVcsRUFBRSxjQUFjO1NBQzVCLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRTtZQUN2QixVQUFVLEVBQUUsSUFBSTtZQUNoQixXQUFXLEVBQUUsb0NBQW9DO1lBQ2pELFFBQVEsRUFBRTtnQkFDUixTQUFTLEVBQUUsSUFBSTtnQkFDZixVQUFVLEVBQUUsSUFBSTthQUNqQjtTQUNGLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxjQUFjLENBQUMsWUFBWSxDQUFDLG1CQUFtQjtZQUN0RCxXQUFXLEVBQUUsK0NBQStDO1NBQzdELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLFVBQVUsY0FBYyxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsRUFBRTtZQUNsRSxXQUFXLEVBQUUsaURBQWlEO1NBQy9ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxPQUFPLENBQUMsV0FBVztZQUMxQixXQUFXLEVBQUUsdURBQXVEO1NBQ3JFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztZQUNwQixXQUFXLEVBQUUsZ0JBQWdCO1NBQzlCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLEdBQUcsT0FBTyxDQUFDLFdBQVcsU0FBUztZQUN0QyxXQUFXLEVBQUUsdUNBQXVDO1NBQ3JELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JDLEtBQUssRUFBRSxPQUFPLENBQUMsV0FBVztZQUMxQixXQUFXLEVBQUUsa0JBQWtCO1NBQ2hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JDLEtBQUssRUFBRSxjQUFjLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDekMsV0FBVyxFQUFFLGtCQUFrQjtTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxjQUFjLENBQUMsaUJBQWlCO1lBQ3ZDLFdBQVcsRUFBRSxxQkFBcUI7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxZQUFZO1lBQzVCLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDL0IsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLO1lBQ2hCLFdBQVcsRUFBRSxRQUFRO1NBQ3RCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlO1lBQzNFLFdBQVcsRUFBRSxtQ0FBbUM7U0FDakQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBOU9ELHdDQThPQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgKiBhcyBlY3NQYXR0ZXJucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXl2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXl2MkludGVncmF0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9ucyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgY2xhc3MgRWZmZWN0QXBwU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgVlBDIGZvciB0aGUgaW5mcmFzdHJ1Y3R1cmVcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnRWZmZWN0QXBwVnBjJywge1xuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ1B1YmxpY1N1Ym5ldCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdQcml2YXRlU3VibmV0JyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBFQ1MgQ2x1c3RlclxuICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgJ0VmZmVjdEFwcENsdXN0ZXInLCB7XG4gICAgICB2cGMsXG4gICAgICBjbHVzdGVyTmFtZTogJ2VmZmVjdC1hcHAtY2x1c3RlcicsXG4gICAgICBjb250YWluZXJJbnNpZ2h0czogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIExvZyBHcm91cFxuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0VmZmVjdEFwcExvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2Vjcy9lZmZlY3QtYXBwLWZhcmdhdGUnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFRhc2sgRGVmaW5pdGlvblxuICAgIGNvbnN0IHRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ0VmZmVjdEFwcFRhc2tEZWYnLCB7XG4gICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxuICAgICAgY3B1OiAyNTYsXG4gICAgICBmYW1pbHk6ICdlZmZlY3QtYXBwLXRhc2snLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbnRhaW5lciB0byB0YXNrIGRlZmluaXRpb25cbiAgICBjb25zdCBjb250YWluZXIgPSB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ0VmZmVjdEFwcENvbnRhaW5lcicsIHtcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KCc4MjI4MTIzMjYwNzAuZGtyLmVjci51cy13ZXN0LTIuYW1hem9uYXdzLmNvbS9lZmZlY3QtYXBwOmxhdGVzdCcpLCAvLyBXaWxsIGJlIHVwZGF0ZWQgd2l0aCBFQ1IgVVJJXG4gICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxuICAgICAgY3B1OiAyNTYsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICAgICAgICBQT1JUOiAnMzAwMCcsXG4gICAgICB9LFxuICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgIHN0cmVhbVByZWZpeDogJ2VmZmVjdC1hcHAnLFxuICAgICAgICBsb2dHcm91cDogbG9nR3JvdXAsXG4gICAgICB9KSxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIGNvbW1hbmQ6IFsnQ01ELVNIRUxMJywgJ2N1cmwgLWYgaHR0cDovL2xvY2FsaG9zdDozMDAwL2hlYWx0aCB8fCBleGl0IDEnXSxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIHJldHJpZXM6IDMsXG4gICAgICAgIHN0YXJ0UGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHBvcnQgbWFwcGluZ1xuICAgIGNvbnRhaW5lci5hZGRQb3J0TWFwcGluZ3Moe1xuICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVENQLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEZhcmdhdGUgU2VydmljZSB3aXRoIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXJcbiAgICBjb25zdCBmYXJnYXRlU2VydmljZSA9IG5ldyBlY3NQYXR0ZXJucy5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlKHRoaXMsICdFZmZlY3RBcHBTZXJ2aWNlJywge1xuICAgICAgY2x1c3RlcixcbiAgICAgIHRhc2tEZWZpbml0aW9uLFxuICAgICAgc2VydmljZU5hbWU6ICdlZmZlY3QtYXBwLXNlcnZpY2UnLFxuICAgICAgcHVibGljTG9hZEJhbGFuY2VyOiB0cnVlLFxuICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcbiAgICAgIGNwdTogMjU2LFxuICAgICAgZGVzaXJlZENvdW50OiAyLFxuICAgICAgbGlzdGVuZXJQb3J0OiA4MCxcbiAgICAgIGhlYWx0aENoZWNrR3JhY2VQZXJpb2Q6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEyMCksXG4gICAgICBkb21haW5ab25lOiB1bmRlZmluZWQsIC8vIENhbiBiZSBjb25maWd1cmVkIGxhdGVyIGZvciBjdXN0b20gZG9tYWluXG4gICAgICBwbGF0Zm9ybVZlcnNpb246IGVjcy5GYXJnYXRlUGxhdGZvcm1WZXJzaW9uLkxBVEVTVCxcbiAgICB9KTtcblxuICAgIC8vIENvbmZpZ3VyZSBoZWFsdGggY2hlY2sgZm9yIHRoZSB0YXJnZXQgZ3JvdXBcbiAgICBmYXJnYXRlU2VydmljZS50YXJnZXRHcm91cC5jb25maWd1cmVIZWFsdGhDaGVjayh7XG4gICAgICBwYXRoOiAnL2hlYWx0aCcsXG4gICAgICBwb3J0OiAnMzAwMCcsXG4gICAgICBoZWFsdGh5SHR0cENvZGVzOiAnMjAwJyxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgIHVuaGVhbHRoeVRocmVzaG9sZENvdW50OiAzLFxuICAgIH0pO1xuXG4gICAgLy8gQ29uZmlndXJlIHNlcnZpY2UgYXV0byBzY2FsaW5nXG4gICAgY29uc3Qgc2NhbGluZyA9IGZhcmdhdGVTZXJ2aWNlLnNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiAxLFxuICAgICAgbWF4Q2FwYWNpdHk6IDEwLFxuICAgIH0pO1xuXG4gICAgc2NhbGluZy5zY2FsZU9uQ3B1VXRpbGl6YXRpb24oJ0NwdVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDcwLFxuICAgICAgc2NhbGVJbkNvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMDApLFxuICAgICAgc2NhbGVPdXRDb29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgIH0pO1xuXG4gICAgc2NhbGluZy5zY2FsZU9uTWVtb3J5VXRpbGl6YXRpb24oJ01lbW9yeVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDgwLFxuICAgICAgc2NhbGVJbkNvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMDApLFxuICAgICAgc2NhbGVPdXRDb29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFZQQyBMaW5rIGZvciBBUEkgR2F0ZXdheSB2MlxuICAgIGNvbnN0IHZwY0xpbmsgPSBuZXcgYXBpZ2F0ZXdheXYyLlZwY0xpbmsodGhpcywgJ0VmZmVjdEFwcFZwY0xpbmsnLCB7XG4gICAgICB2cGMsXG4gICAgICBzdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIHZwY0xpbmtOYW1lOiAnZWZmZWN0LWFwcC12cGMtbGluaycsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgSFRUUCBBUEkgR2F0ZXdheSB2MlxuICAgIGNvbnN0IGh0dHBBcGkgPSBuZXcgYXBpZ2F0ZXdheXYyLkh0dHBBcGkodGhpcywgJ0VmZmVjdEFwcEh0dHBBcGknLCB7XG4gICAgICBhcGlOYW1lOiAnZWZmZWN0LWFwcC1hcGknLFxuICAgICAgZGVzY3JpcHRpb246ICdFZmZlY3QtVFMgSFRUUCBBUEkgR2F0ZXdheScsXG4gICAgICBjb3JzUHJlZmxpZ2h0OiB7XG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnWC1BbXotRGF0ZScsICdBdXRob3JpemF0aW9uJywgJ1gtQXBpLUtleScsICdYLUFtei1TZWN1cml0eS1Ub2tlbicsICdDb29raWUnXSxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbXG4gICAgICAgICAgYXBpZ2F0ZXdheXYyLkNvcnNIdHRwTWV0aG9kLkdFVCxcbiAgICAgICAgICBhcGlnYXRld2F5djIuQ29yc0h0dHBNZXRob2QuUE9TVCxcbiAgICAgICAgICBhcGlnYXRld2F5djIuQ29yc0h0dHBNZXRob2QuUFVULFxuICAgICAgICAgIGFwaWdhdGV3YXl2Mi5Db3JzSHR0cE1ldGhvZC5QQVRDSCxcbiAgICAgICAgICBhcGlnYXRld2F5djIuQ29yc0h0dHBNZXRob2QuREVMRVRFLFxuICAgICAgICAgIGFwaWdhdGV3YXl2Mi5Db3JzSHR0cE1ldGhvZC5PUFRJT05TLFxuICAgICAgICBdLFxuICAgICAgICBhbGxvd09yaWdpbnM6IFsnKiddLCAvLyBDb25maWd1cmUgYXBwcm9wcmlhdGVseSBmb3IgcHJvZHVjdGlvblxuICAgICAgICBtYXhBZ2U6IGNkay5EdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBTEIgSW50ZWdyYXRpb24gZm9yIEhUVFAgQVBJXG4gICAgY29uc3QgYWxiSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheXYySW50ZWdyYXRpb25zLkh0dHBBbGJJbnRlZ3JhdGlvbignQWxiSW50ZWdyYXRpb24nLCBcbiAgICAgIGZhcmdhdGVTZXJ2aWNlLmxpc3RlbmVyLFxuICAgICAge1xuICAgICAgICB2cGNMaW5rLFxuICAgICAgICBwYXJhbWV0ZXJNYXBwaW5nOiBuZXcgYXBpZ2F0ZXdheXYyLlBhcmFtZXRlck1hcHBpbmcoKVxuICAgICAgICAgIC5hcHBlbmRIZWFkZXIoJ3gtZm9yd2FyZGVkLWZvcicsIGFwaWdhdGV3YXl2Mi5NYXBwaW5nVmFsdWUuY29udGV4dFZhcmlhYmxlKCdpZGVudGl0eS5zb3VyY2VJcCcpKVxuICAgICAgICAgIC5hcHBlbmRIZWFkZXIoJ3gtZm9yd2FyZGVkLXByb3RvJywgYXBpZ2F0ZXdheXYyLk1hcHBpbmdWYWx1ZS5jdXN0b20oJ2h0dHBzJykpLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBBZGQgcm91dGVzIHRvIEhUVFAgQVBJXG4gICAgaHR0cEFwaS5hZGRSb3V0ZXMoe1xuICAgICAgcGF0aDogJy97cHJveHkrfScsXG4gICAgICBtZXRob2RzOiBbXG4gICAgICAgIGFwaWdhdGV3YXl2Mi5IdHRwTWV0aG9kLkdFVCxcbiAgICAgICAgYXBpZ2F0ZXdheXYyLkh0dHBNZXRob2QuUE9TVCxcbiAgICAgICAgYXBpZ2F0ZXdheXYyLkh0dHBNZXRob2QuUFVULFxuICAgICAgICBhcGlnYXRld2F5djIuSHR0cE1ldGhvZC5QQVRDSCxcbiAgICAgICAgYXBpZ2F0ZXdheXYyLkh0dHBNZXRob2QuREVMRVRFLFxuICAgICAgXSxcbiAgICAgIGludGVncmF0aW9uOiBhbGJJbnRlZ3JhdGlvbixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBkZWZhdWx0IHJvdXRlIGZvciByb290IHBhdGhcbiAgICBodHRwQXBpLmFkZFJvdXRlcyh7XG4gICAgICBwYXRoOiAnLycsXG4gICAgICBtZXRob2RzOiBbYXBpZ2F0ZXdheXYyLkh0dHBNZXRob2QuR0VUXSxcbiAgICAgIGludGVncmF0aW9uOiBhbGJJbnRlZ3JhdGlvbixcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBkZXBsb3ltZW50IHN0YWdlXG4gICAgaHR0cEFwaS5hZGRTdGFnZSgncHJvZCcsIHtcbiAgICAgIGF1dG9EZXBsb3k6IHRydWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1Byb2R1Y3Rpb24gc3RhZ2UgZm9yIEVmZmVjdC1UUyBBUEknLFxuICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgcmF0ZUxpbWl0OiAxMDAwLFxuICAgICAgICBidXJzdExpbWl0OiAyMDAwLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBpbXBvcnRhbnQgaW5mb3JtYXRpb25cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9hZEJhbGFuY2VyRE5TJywge1xuICAgICAgdmFsdWU6IGZhcmdhdGVTZXJ2aWNlLmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdETlMgbmFtZSBvZiB0aGUgbG9hZCBiYWxhbmNlciAtIGRpcmVjdCBhY2Nlc3MnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvYWRCYWxhbmNlclVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7ZmFyZ2F0ZVNlcnZpY2UubG9hZEJhbGFuY2VyLmxvYWRCYWxhbmNlckRuc05hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGlyZWN0IFVSTCB0byBhY2Nlc3MgeW91ciBBUEkgdmlhIExvYWQgQmFsYW5jZXInLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogaHR0cEFwaS5hcGlFbmRwb2ludCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgZW5kcG9pbnQgVVJMIC0gcmVjb21tZW5kZWQgZm9yIHByb2R1Y3Rpb24nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlJZCcsIHtcbiAgICAgIHZhbHVlOiBodHRwQXBpLmFwaUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBJRCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSGVhbHRoQ2hlY2tVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7aHR0cEFwaS5hcGlFbmRwb2ludH0vaGVhbHRoYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSGVhbHRoIGNoZWNrIGVuZHBvaW50IHZpYSBBUEkgR2F0ZXdheScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2x1c3Rlck5hbWUnLCB7XG4gICAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIENsdXN0ZXIgbmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2VydmljZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogZmFyZ2F0ZVNlcnZpY2Uuc2VydmljZS5zZXJ2aWNlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIFNlcnZpY2UgbmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVGFza0RlZmluaXRpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGFza0RlZmluaXRpb24udGFza0RlZmluaXRpb25Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1Rhc2sgRGVmaW5pdGlvbiBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiBsb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIG5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xuICAgICAgdmFsdWU6IHZwYy52cGNJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVlBDIElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogZmFyZ2F0ZVNlcnZpY2Uuc2VydmljZS5jb25uZWN0aW9ucy5zZWN1cml0eUdyb3Vwc1swXS5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IEdyb3VwIElEIGZvciBFQ1Mgc2VydmljZScsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==