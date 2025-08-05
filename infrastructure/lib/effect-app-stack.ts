import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class EffectAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(auroraCluster.secret!, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(auroraCluster.secret!, 'password'),
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
    dbSecurityGroup.addIngressRule(
      effectAppSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS service to connect to Aurora PostgreSQL'
    );

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
