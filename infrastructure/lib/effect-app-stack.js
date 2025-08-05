"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EffectAppStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const apigatewayv2 = require("aws-cdk-lib/aws-apigatewayv2");
const logs = require("aws-cdk-lib/aws-logs");
const iam = require("aws-cdk-lib/aws-iam");
const ecr = require("aws-cdk-lib/aws-ecr");
const rds = require("aws-cdk-lib/aws-rds");
class EffectAppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC with proper configuration
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
                {
                    cidrMask: 24,
                    name: 'DatabaseSubnet',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });
        // Create Aurora PostgreSQL cluster
        const dbCredentials = rds.Credentials.fromGeneratedSecret('postgres', {
            secretName: 'effect-app/aurora-postgres-credentials',
        });
        // Create security group for Aurora PostgreSQL
        const dbSecurityGroup = new ec2.SecurityGroup(this, 'AuroraPostgresSecurityGroup', {
            vpc,
            allowAllOutbound: false,
            securityGroupName: 'aurora-postgres-security-group',
            description: 'Security group for Aurora PostgreSQL cluster',
        });
        // Create Aurora PostgreSQL cluster
        const auroraCluster = new rds.DatabaseCluster(this, 'AuroraPostgresCluster', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_4,
            }),
            credentials: dbCredentials,
            instanceProps: {
                vpc,
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
                securityGroups: [dbSecurityGroup],
            },
            instances: 1,
            defaultDatabaseName: 'effect_app',
            backup: {
                retention: cdk.Duration.days(7),
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development/testing
            deletionProtection: false, // For development/testing
            storageEncrypted: true,
        });
        // Create ECS Cluster
        const cluster = new ecs.Cluster(this, 'EffectAppCluster', {
            vpc,
            clusterName: 'effect-app-cluster',
            containerInsights: true,
        });
        // Create CloudWatch Log Group
        const logGroup = new logs.LogGroup(this, 'EffectAppLogGroup', {
            logGroupName: '/ecs/effect-app',
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Create task execution role (following AWS sample pattern)
        const taskExecutionRole = new iam.Role(this, 'EffectAppTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        // Add permissions to read database secrets
        auroraCluster.secret?.grantRead(taskExecutionRole);
        // Get reference to ECR repository
        const ecrRepository = ecr.Repository.fromRepositoryName(this, 'EffectAppEcrRepo', 'effect-app');
        // Create Task Definition with proper configuration
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'EffectAppTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
            family: 'effect-app-task',
            executionRole: taskExecutionRole,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.ARM64,
            },
        });
        // Add container to task definition (following AWS sample pattern)
        const container = taskDefinition.addContainer('EffectAppContainer', {
            image: ecs.ContainerImage.fromEcrRepository(ecrRepository, 'latest'),
            memoryLimitMiB: 512,
            essential: true,
            environment: {
                NODE_ENV: 'production',
                PORT: '3000',
                DATABASE_HOST: auroraCluster.clusterEndpoint.hostname,
                DATABASE_PORT: auroraCluster.clusterEndpoint.port.toString(),
                DATABASE_NAME: 'effect_app',
                DATABASE_SSL: 'true',
                DATABASE_MAX_CONNECTIONS: '10',
            },
            secrets: {
                DATABASE_USERNAME: ecs.Secret.fromSecretsManager(auroraCluster.secret, 'username'),
                DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(auroraCluster.secret, 'password'),
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'effect-app',
                logGroup: logGroup,
            }),
        });
        // Add port mapping
        container.addPortMappings({
            containerPort: 3000,
            protocol: ecs.Protocol.TCP,
        });
        // Create Security Group for ECS Service (following AWS sample pattern)
        const effectAppSecurityGroup = new ec2.SecurityGroup(this, 'EffectAppSecurityGroup', {
            vpc,
            allowAllOutbound: true,
            securityGroupName: 'effect-app-security-group',
            description: 'Security group for Effect App ECS service',
        });
        effectAppSecurityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(3000));
        // Allow ECS service to connect to Aurora PostgreSQL
        dbSecurityGroup.addIngressRule(effectAppSecurityGroup, ec2.Port.tcp(5432), 'Allow ECS service to connect to Aurora PostgreSQL');
        // Create Fargate Service (following AWS sample pattern)
        const effectAppService = new ecs.FargateService(this, 'EffectAppService', {
            cluster,
            taskDefinition,
            serviceName: 'effect-app-service',
            assignPublicIp: false,
            desiredCount: 1,
            securityGroups: [effectAppSecurityGroup],
            platformVersion: ecs.FargatePlatformVersion.LATEST,
        });
        // Create Application Load Balancer (internal for VPC Link pattern)
        const internalALB = new elbv2.ApplicationLoadBalancer(this, 'EffectAppInternalALB', {
            vpc,
            internetFacing: false,
            loadBalancerName: 'effect-app-internal-alb',
        });
        // Create ALB Listener
        const albListener = internalALB.addListener('EffectAppListener', {
            port: 80,
            defaultAction: elbv2.ListenerAction.fixedResponse(200, {
                contentType: 'text/plain',
                messageBody: 'Default response',
            }),
        });
        // Create Target Group and add to listener (following AWS sample health check pattern)
        const targetGroup = albListener.addTargets('EffectAppTargetGroup', {
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            priority: 1,
            healthCheck: {
                path: '/health',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
                healthyHttpCodes: '200',
            },
            targets: [effectAppService],
            conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])], // Match all paths
        });
        // Configure service auto scaling
        const scaling = effectAppService.autoScaleTaskCount({
            minCapacity: 1,
            maxCapacity: 5,
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
        // Create Security Group for VPC Link
        const vpcLinkSecurityGroup = new ec2.SecurityGroup(this, 'VpcLinkSecurityGroup', {
            vpc,
            allowAllOutbound: true,
            securityGroupName: 'vpc-link-security-group',
            description: 'Security group for VPC Link to access internal ALB',
        });
        // Allow VPC Link to reach the internal ALB on port 80
        vpcLinkSecurityGroup.connections.allowTo(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'VPC Link to ALB');
        // Create VPC Link for API Gateway (following AWS sample pattern)
        const vpcLink = new cdk.CfnResource(this, 'EffectAppVpcLink', {
            type: 'AWS::ApiGatewayV2::VpcLink',
            properties: {
                Name: 'effect-app-vpclink',
                SubnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
                SecurityGroupIds: [vpcLinkSecurityGroup.securityGroupId],
            },
        });
        // Create HTTP API Gateway v2 (following AWS sample pattern)
        const httpApi = new apigatewayv2.HttpApi(this, 'EffectAppHttpApi', {
            apiName: 'effect-app-api',
            description: 'Effect-TS HTTP API Gateway',
            createDefaultStage: true,
        });
        // Create API Integration using VPC Link (following AWS sample pattern)
        const integration = new apigatewayv2.CfnIntegration(this, 'EffectAppIntegration', {
            apiId: httpApi.httpApiId,
            connectionId: vpcLink.ref,
            connectionType: 'VPC_LINK',
            description: 'Effect App API Integration',
            integrationMethod: 'ANY',
            integrationType: 'HTTP_PROXY',
            integrationUri: albListener.listenerArn,
            payloadFormatVersion: '1.0',
        });
        // Create API Route (following AWS sample pattern)
        new apigatewayv2.CfnRoute(this, 'EffectAppRoute', {
            apiId: httpApi.httpApiId,
            routeKey: 'ANY /{proxy+}',
            target: `integrations/${integration.ref}`,
        });
        // Create root route as well
        new apigatewayv2.CfnRoute(this, 'EffectAppRootRoute', {
            apiId: httpApi.httpApiId,
            routeKey: 'ANY /',
            target: `integrations/${integration.ref}`,
        });
        // Output important information
        new cdk.CfnOutput(this, 'InternalLoadBalancerDNS', {
            value: internalALB.loadBalancerDnsName,
            description: 'Internal Load Balancer DNS name',
        });
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: httpApi.url || httpApi.apiEndpoint,
            description: 'API Gateway endpoint URL',
        });
        new cdk.CfnOutput(this, 'ApiGatewayId', {
            value: httpApi.httpApiId,
            description: 'API Gateway ID',
        });
        new cdk.CfnOutput(this, 'HealthCheckUrl', {
            value: `${httpApi.url || httpApi.apiEndpoint}health`,
            description: 'Health check endpoint via API Gateway',
        });
        new cdk.CfnOutput(this, 'ClusterName', {
            value: cluster.clusterName,
            description: 'ECS Cluster name',
        });
        new cdk.CfnOutput(this, 'ServiceName', {
            value: effectAppService.serviceName,
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
            value: effectAppSecurityGroup.securityGroupId,
            description: 'Security Group ID for ECS service',
        });
        // Aurora PostgreSQL outputs
        new cdk.CfnOutput(this, 'AuroraClusterEndpoint', {
            value: auroraCluster.clusterEndpoint.hostname,
            description: 'Aurora PostgreSQL cluster endpoint',
        });
        new cdk.CfnOutput(this, 'AuroraClusterPort', {
            value: auroraCluster.clusterEndpoint.port.toString(),
            description: 'Aurora PostgreSQL cluster port',
        });
        new cdk.CfnOutput(this, 'AuroraSecretArn', {
            value: auroraCluster.secret?.secretArn || 'No secret available',
            description: 'Aurora PostgreSQL credentials secret ARN',
        });
        new cdk.CfnOutput(this, 'DatabaseName', {
            value: 'effect_app',
            description: 'Default database name',
        });
    }
}
exports.EffectAppStack = EffectAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWZmZWN0LWFwcC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImVmZmVjdC1hcHAtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsZ0VBQWdFO0FBQ2hFLDZEQUE2RDtBQUU3RCw2Q0FBNkM7QUFDN0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQywyQ0FBMkM7QUFJM0MsTUFBYSxjQUFlLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix1Q0FBdUM7UUFDdkMsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDNUMsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztZQUNkLG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsY0FBYztvQkFDcEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGVBQWU7b0JBQ3JCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7Z0JBQ0Q7b0JBQ0UsUUFBUSxFQUFFLEVBQUU7b0JBQ1osSUFBSSxFQUFFLGdCQUFnQjtvQkFDdEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO2lCQUM1QzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsbUNBQW1DO1FBQ25DLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQUMsbUJBQW1CLENBQUMsVUFBVSxFQUFFO1lBQ3BFLFVBQVUs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cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVsYnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXl2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXl2MkludGVncmF0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9ucyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGNsYXNzIEVmZmVjdEFwcFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIFZQQyB3aXRoIHByb3BlciBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgdnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0VmZmVjdEFwcFZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdQdWJsaWNTdWJuZXQnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZVN1Ym5ldCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnRGF0YWJhc2VTdWJuZXQnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEF1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXJcbiAgICBjb25zdCBkYkNyZWRlbnRpYWxzID0gcmRzLkNyZWRlbnRpYWxzLmZyb21HZW5lcmF0ZWRTZWNyZXQoJ3Bvc3RncmVzJywge1xuICAgICAgc2VjcmV0TmFtZTogJ2VmZmVjdC1hcHAvYXVyb3JhLXBvc3RncmVzLWNyZWRlbnRpYWxzJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBzZWN1cml0eSBncm91cCBmb3IgQXVyb3JhIFBvc3RncmVTUUxcbiAgICBjb25zdCBkYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0F1cm9yYVBvc3RncmVzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6ICdhdXJvcmEtcG9zdGdyZXMtc2VjdXJpdHktZ3JvdXAnLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgQXVyb3JhIFBvc3RncmVTUUwgY2x1c3RlcicsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQXVyb3JhIFBvc3RncmVTUUwgY2x1c3RlclxuICAgIGNvbnN0IGF1cm9yYUNsdXN0ZXIgPSBuZXcgcmRzLkRhdGFiYXNlQ2x1c3Rlcih0aGlzLCAnQXVyb3JhUG9zdGdyZXNDbHVzdGVyJywge1xuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYVBvc3RncmVzKHtcbiAgICAgICAgdmVyc2lvbjogcmRzLkF1cm9yYVBvc3RncmVzRW5naW5lVmVyc2lvbi5WRVJfMTVfNCxcbiAgICAgIH0pLFxuICAgICAgY3JlZGVudGlhbHM6IGRiQ3JlZGVudGlhbHMsXG4gICAgICBpbnN0YW5jZVByb3BzOiB7XG4gICAgICAgIHZwYyxcbiAgICAgICAgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlQzLCBlYzIuSW5zdGFuY2VTaXplLk1FRElVTSksXG4gICAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgICBzZWN1cml0eUdyb3VwczogW2RiU2VjdXJpdHlHcm91cF0sXG4gICAgICB9LFxuICAgICAgaW5zdGFuY2VzOiAxLFxuICAgICAgZGVmYXVsdERhdGFiYXNlTmFtZTogJ2VmZmVjdF9hcHAnLFxuICAgICAgYmFja3VwOiB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gRm9yIGRldmVsb3BtZW50L3Rlc3RpbmdcbiAgICAgIGRlbGV0aW9uUHJvdGVjdGlvbjogZmFsc2UsIC8vIEZvciBkZXZlbG9wbWVudC90ZXN0aW5nXG4gICAgICBzdG9yYWdlRW5jcnlwdGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnRWZmZWN0QXBwQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGNsdXN0ZXJOYW1lOiAnZWZmZWN0LWFwcC1jbHVzdGVyJyxcbiAgICAgIGNvbnRhaW5lckluc2lnaHRzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggTG9nIEdyb3VwXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnRWZmZWN0QXBwTG9nR3JvdXAnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6ICcvZWNzL2VmZmVjdC1hcHAnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIHRhc2sgZXhlY3V0aW9uIHJvbGUgKGZvbGxvd2luZyBBV1Mgc2FtcGxlIHBhdHRlcm4pXG4gICAgY29uc3QgdGFza0V4ZWN1dGlvblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0VmZmVjdEFwcFRhc2tFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgcGVybWlzc2lvbnMgdG8gcmVhZCBkYXRhYmFzZSBzZWNyZXRzXG4gICAgYXVyb3JhQ2x1c3Rlci5zZWNyZXQ/LmdyYW50UmVhZCh0YXNrRXhlY3V0aW9uUm9sZSk7XG5cbiAgICAvLyBHZXQgcmVmZXJlbmNlIHRvIEVDUiByZXBvc2l0b3J5XG4gICAgY29uc3QgZWNyUmVwb3NpdG9yeSA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZSh0aGlzLCAnRWZmZWN0QXBwRWNyUmVwbycsICdlZmZlY3QtYXBwJyk7XG5cbiAgICAvLyBDcmVhdGUgVGFzayBEZWZpbml0aW9uIHdpdGggcHJvcGVyIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCB0YXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsICdFZmZlY3RBcHBUYXNrRGVmJywge1xuICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcbiAgICAgIGNwdTogMjU2LFxuICAgICAgZmFtaWx5OiAnZWZmZWN0LWFwcC10YXNrJyxcbiAgICAgIGV4ZWN1dGlvblJvbGU6IHRhc2tFeGVjdXRpb25Sb2xlLFxuICAgICAgcnVudGltZVBsYXRmb3JtOiB7XG4gICAgICAgIG9wZXJhdGluZ1N5c3RlbUZhbWlseTogZWNzLk9wZXJhdGluZ1N5c3RlbUZhbWlseS5MSU5VWCxcbiAgICAgICAgY3B1QXJjaGl0ZWN0dXJlOiBlY3MuQ3B1QXJjaGl0ZWN0dXJlLkFSTTY0LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uIChmb2xsb3dpbmcgQVdTIHNhbXBsZSBwYXR0ZXJuKVxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignRWZmZWN0QXBwQ29udGFpbmVyJywge1xuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShlY3JSZXBvc2l0b3J5LCAnbGF0ZXN0JyksXG4gICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxuICAgICAgZXNzZW50aWFsOiB0cnVlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcbiAgICAgICAgUE9SVDogJzMwMDAnLFxuICAgICAgICBEQVRBQkFTRV9IT1NUOiBhdXJvcmFDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZSxcbiAgICAgICAgREFUQUJBU0VfUE9SVDogYXVyb3JhQ2x1c3Rlci5jbHVzdGVyRW5kcG9pbnQucG9ydC50b1N0cmluZygpLFxuICAgICAgICBEQVRBQkFTRV9OQU1FOiAnZWZmZWN0X2FwcCcsXG4gICAgICAgIERBVEFCQVNFX1NTTDogJ3RydWUnLFxuICAgICAgICBEQVRBQkFTRV9NQVhfQ09OTkVDVElPTlM6ICcxMCcsXG4gICAgICB9LFxuICAgICAgc2VjcmV0czoge1xuICAgICAgICBEQVRBQkFTRV9VU0VSTkFNRTogZWNzLlNlY3JldC5mcm9tU2VjcmV0c01hbmFnZXIoYXVyb3JhQ2x1c3Rlci5zZWNyZXQhLCAndXNlcm5hbWUnKSxcbiAgICAgICAgREFUQUJBU0VfUEFTU1dPUkQ6IGVjcy5TZWNyZXQuZnJvbVNlY3JldHNNYW5hZ2VyKGF1cm9yYUNsdXN0ZXIuc2VjcmV0ISwgJ3Bhc3N3b3JkJyksXG4gICAgICB9LFxuICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgIHN0cmVhbVByZWZpeDogJ2VmZmVjdC1hcHAnLFxuICAgICAgICBsb2dHcm91cDogbG9nR3JvdXAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBwb3J0IG1hcHBpbmdcbiAgICBjb250YWluZXIuYWRkUG9ydE1hcHBpbmdzKHtcbiAgICAgIGNvbnRhaW5lclBvcnQ6IDMwMDAsXG4gICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUCxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBTZWN1cml0eSBHcm91cCBmb3IgRUNTIFNlcnZpY2UgKGZvbGxvd2luZyBBV1Mgc2FtcGxlIHBhdHRlcm4pXG4gICAgY29uc3QgZWZmZWN0QXBwU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRWZmZWN0QXBwU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogJ2VmZmVjdC1hcHAtc2VjdXJpdHktZ3JvdXAnLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgRWZmZWN0IEFwcCBFQ1Mgc2VydmljZScsXG4gICAgfSk7XG5cbiAgICBlZmZlY3RBcHBTZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbUFueUlwdjQoZWMyLlBvcnQudGNwKDMwMDApKTtcblxuICAgIC8vIEFsbG93IEVDUyBzZXJ2aWNlIHRvIGNvbm5lY3QgdG8gQXVyb3JhIFBvc3RncmVTUUxcbiAgICBkYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlZmZlY3RBcHBTZWN1cml0eUdyb3VwLFxuICAgICAgZWMyLlBvcnQudGNwKDU0MzIpLFxuICAgICAgJ0FsbG93IEVDUyBzZXJ2aWNlIHRvIGNvbm5lY3QgdG8gQXVyb3JhIFBvc3RncmVTUUwnXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBGYXJnYXRlIFNlcnZpY2UgKGZvbGxvd2luZyBBV1Mgc2FtcGxlIHBhdHRlcm4pXG4gICAgY29uc3QgZWZmZWN0QXBwU2VydmljZSA9IG5ldyBlY3MuRmFyZ2F0ZVNlcnZpY2UodGhpcywgJ0VmZmVjdEFwcFNlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb24sXG4gICAgICBzZXJ2aWNlTmFtZTogJ2VmZmVjdC1hcHAtc2VydmljZScsXG4gICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2VmZmVjdEFwcFNlY3VyaXR5R3JvdXBdLFxuICAgICAgcGxhdGZvcm1WZXJzaW9uOiBlY3MuRmFyZ2F0ZVBsYXRmb3JtVmVyc2lvbi5MQVRFU1QsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciAoaW50ZXJuYWwgZm9yIFZQQyBMaW5rIHBhdHRlcm4pXG4gICAgY29uc3QgaW50ZXJuYWxBTEIgPSBuZXcgZWxidjIuQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIodGhpcywgJ0VmZmVjdEFwcEludGVybmFsQUxCJywge1xuICAgICAgdnBjLFxuICAgICAgaW50ZXJuZXRGYWNpbmc6IGZhbHNlLFxuICAgICAgbG9hZEJhbGFuY2VyTmFtZTogJ2VmZmVjdC1hcHAtaW50ZXJuYWwtYWxiJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBTEIgTGlzdGVuZXJcbiAgICBjb25zdCBhbGJMaXN0ZW5lciA9IGludGVybmFsQUxCLmFkZExpc3RlbmVyKCdFZmZlY3RBcHBMaXN0ZW5lcicsIHtcbiAgICAgIHBvcnQ6IDgwLFxuICAgICAgZGVmYXVsdEFjdGlvbjogZWxidjIuTGlzdGVuZXJBY3Rpb24uZml4ZWRSZXNwb25zZSgyMDAsIHtcbiAgICAgICAgY29udGVudFR5cGU6ICd0ZXh0L3BsYWluJyxcbiAgICAgICAgbWVzc2FnZUJvZHk6ICdEZWZhdWx0IHJlc3BvbnNlJyxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFRhcmdldCBHcm91cCBhbmQgYWRkIHRvIGxpc3RlbmVyIChmb2xsb3dpbmcgQVdTIHNhbXBsZSBoZWFsdGggY2hlY2sgcGF0dGVybilcbiAgICBjb25zdCB0YXJnZXRHcm91cCA9IGFsYkxpc3RlbmVyLmFkZFRhcmdldHMoJ0VmZmVjdEFwcFRhcmdldEdyb3VwJywge1xuICAgICAgcG9ydDogMzAwMCxcbiAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICBwcmlvcml0eTogMSxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIHBhdGg6ICcvaGVhbHRoJyxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgICAgIGhlYWx0aHlIdHRwQ29kZXM6ICcyMDAnLFxuICAgICAgfSxcbiAgICAgIHRhcmdldHM6IFtlZmZlY3RBcHBTZXJ2aWNlXSxcbiAgICAgIGNvbmRpdGlvbnM6IFtlbGJ2Mi5MaXN0ZW5lckNvbmRpdGlvbi5wYXRoUGF0dGVybnMoWycvKiddKV0sIC8vIE1hdGNoIGFsbCBwYXRoc1xuICAgIH0pO1xuXG4gICAgLy8gQ29uZmlndXJlIHNlcnZpY2UgYXV0byBzY2FsaW5nXG4gICAgY29uc3Qgc2NhbGluZyA9IGVmZmVjdEFwcFNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiAxLFxuICAgICAgbWF4Q2FwYWNpdHk6IDUsXG4gICAgfSk7XG5cbiAgICBzY2FsaW5nLnNjYWxlT25DcHVVdGlsaXphdGlvbignQ3B1U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogNzAsXG4gICAgICBzY2FsZUluQ29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICBzY2FsZU91dENvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgfSk7XG5cbiAgICBzY2FsaW5nLnNjYWxlT25NZW1vcnlVdGlsaXphdGlvbignTWVtb3J5U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogODAsXG4gICAgICBzY2FsZUluQ29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICBzY2FsZU91dENvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgU2VjdXJpdHkgR3JvdXAgZm9yIFZQQyBMaW5rXG4gICAgY29uc3QgdnBjTGlua1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1ZwY0xpbmtTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiAndnBjLWxpbmstc2VjdXJpdHktZ3JvdXAnLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgVlBDIExpbmsgdG8gYWNjZXNzIGludGVybmFsIEFMQicsXG4gICAgfSk7XG5cbiAgICAvLyBBbGxvdyBWUEMgTGluayB0byByZWFjaCB0aGUgaW50ZXJuYWwgQUxCIG9uIHBvcnQgODBcbiAgICB2cGNMaW5rU2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd1RvKGVjMi5QZWVyLmFueUlwdjQoKSwgZWMyLlBvcnQudGNwKDgwKSwgJ1ZQQyBMaW5rIHRvIEFMQicpO1xuXG4gICAgLy8gQ3JlYXRlIFZQQyBMaW5rIGZvciBBUEkgR2F0ZXdheSAoZm9sbG93aW5nIEFXUyBzYW1wbGUgcGF0dGVybilcbiAgICBjb25zdCB2cGNMaW5rID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnRWZmZWN0QXBwVnBjTGluaycsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkFwaUdhdGV3YXlWMjo6VnBjTGluaycsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIE5hbWU6ICdlZmZlY3QtYXBwLXZwY2xpbmsnLFxuICAgICAgICBTdWJuZXRJZHM6IHZwYy5wcml2YXRlU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCksXG4gICAgICAgIFNlY3VyaXR5R3JvdXBJZHM6IFt2cGNMaW5rU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBIVFRQIEFQSSBHYXRld2F5IHYyIChmb2xsb3dpbmcgQVdTIHNhbXBsZSBwYXR0ZXJuKVxuICAgIGNvbnN0IGh0dHBBcGkgPSBuZXcgYXBpZ2F0ZXdheXYyLkh0dHBBcGkodGhpcywgJ0VmZmVjdEFwcEh0dHBBcGknLCB7XG4gICAgICBhcGlOYW1lOiAnZWZmZWN0LWFwcC1hcGknLFxuICAgICAgZGVzY3JpcHRpb246ICdFZmZlY3QtVFMgSFRUUCBBUEkgR2F0ZXdheScsXG4gICAgICBjcmVhdGVEZWZhdWx0U3RhZ2U6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQVBJIEludGVncmF0aW9uIHVzaW5nIFZQQyBMaW5rIChmb2xsb3dpbmcgQVdTIHNhbXBsZSBwYXR0ZXJuKVxuICAgIGNvbnN0IGludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXl2Mi5DZm5JbnRlZ3JhdGlvbih0aGlzLCAnRWZmZWN0QXBwSW50ZWdyYXRpb24nLCB7XG4gICAgICBhcGlJZDogaHR0cEFwaS5odHRwQXBpSWQsXG4gICAgICBjb25uZWN0aW9uSWQ6IHZwY0xpbmsucmVmLFxuICAgICAgY29ubmVjdGlvblR5cGU6ICdWUENfTElOSycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VmZmVjdCBBcHAgQVBJIEludGVncmF0aW9uJyxcbiAgICAgIGludGVncmF0aW9uTWV0aG9kOiAnQU5ZJyxcbiAgICAgIGludGVncmF0aW9uVHlwZTogJ0hUVFBfUFJPWFknLFxuICAgICAgaW50ZWdyYXRpb25Vcmk6IGFsYkxpc3RlbmVyLmxpc3RlbmVyQXJuLFxuICAgICAgcGF5bG9hZEZvcm1hdFZlcnNpb246ICcxLjAnLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEFQSSBSb3V0ZSAoZm9sbG93aW5nIEFXUyBzYW1wbGUgcGF0dGVybilcbiAgICBuZXcgYXBpZ2F0ZXdheXYyLkNmblJvdXRlKHRoaXMsICdFZmZlY3RBcHBSb3V0ZScsIHtcbiAgICAgIGFwaUlkOiBodHRwQXBpLmh0dHBBcGlJZCxcbiAgICAgIHJvdXRlS2V5OiAnQU5ZIC97cHJveHkrfScsXG4gICAgICB0YXJnZXQ6IGBpbnRlZ3JhdGlvbnMvJHtpbnRlZ3JhdGlvbi5yZWZ9YCxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSByb290IHJvdXRlIGFzIHdlbGxcbiAgICBuZXcgYXBpZ2F0ZXdheXYyLkNmblJvdXRlKHRoaXMsICdFZmZlY3RBcHBSb290Um91dGUnLCB7XG4gICAgICBhcGlJZDogaHR0cEFwaS5odHRwQXBpSWQsXG4gICAgICByb3V0ZUtleTogJ0FOWSAvJyxcbiAgICAgIHRhcmdldDogYGludGVncmF0aW9ucy8ke2ludGVncmF0aW9uLnJlZn1gLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0IGltcG9ydGFudCBpbmZvcm1hdGlvblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbnRlcm5hbExvYWRCYWxhbmNlckROUycsIHtcbiAgICAgIHZhbHVlOiBpbnRlcm5hbEFMQi5sb2FkQmFsYW5jZXJEbnNOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnRlcm5hbCBMb2FkIEJhbGFuY2VyIEROUyBuYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlHYXRld2F5VXJsJywge1xuICAgICAgdmFsdWU6IGh0dHBBcGkudXJsIHx8IGh0dHBBcGkuYXBpRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IGVuZHBvaW50IFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheUlkJywge1xuICAgICAgdmFsdWU6IGh0dHBBcGkuaHR0cEFwaUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBJRCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSGVhbHRoQ2hlY2tVcmwnLCB7XG4gICAgICB2YWx1ZTogYCR7aHR0cEFwaS51cmwgfHwgaHR0cEFwaS5hcGlFbmRwb2ludH1oZWFsdGhgLFxuICAgICAgZGVzY3JpcHRpb246ICdIZWFsdGggY2hlY2sgZW5kcG9pbnQgdmlhIEFQSSBHYXRld2F5JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyTmFtZScsIHtcbiAgICAgIHZhbHVlOiBjbHVzdGVyLmNsdXN0ZXJOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgQ2x1c3RlciBuYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZXJ2aWNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiBlZmZlY3RBcHBTZXJ2aWNlLnNlcnZpY2VOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgU2VydmljZSBuYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdUYXNrRGVmaW5pdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiB0YXNrRGVmaW5pdGlvbi50YXNrRGVmaW5pdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnVGFzayBEZWZpbml0aW9uIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9nR3JvdXBOYW1lJywge1xuICAgICAgdmFsdWU6IGxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXAgbmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XG4gICAgICB2YWx1ZTogdnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgSUQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiBlZmZlY3RBcHBTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgR3JvdXAgSUQgZm9yIEVDUyBzZXJ2aWNlJyxcbiAgICB9KTtcblxuICAgIC8vIEF1cm9yYSBQb3N0Z3JlU1FMIG91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXVyb3JhQ2x1c3RlckVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGF1cm9yYUNsdXN0ZXIuY2x1c3RlckVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyIGVuZHBvaW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdXJvcmFDbHVzdGVyUG9ydCcsIHtcbiAgICAgIHZhbHVlOiBhdXJvcmFDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5wb3J0LnRvU3RyaW5nKCksXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXIgcG9ydCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXVyb3JhU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IGF1cm9yYUNsdXN0ZXIuc2VjcmV0Py5zZWNyZXRBcm4gfHwgJ05vIHNlY3JldCBhdmFpbGFibGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjcmVkZW50aWFscyBzZWNyZXQgQVJOJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogJ2VmZmVjdF9hcHAnLFxuICAgICAgZGVzY3JpcHRpb246ICdEZWZhdWx0IGRhdGFiYXNlIG5hbWUnLFxuICAgIH0pO1xuICB9XG59XG4iXX0=