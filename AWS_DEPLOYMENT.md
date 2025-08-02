# AWS Deployment Guide - Effect-TS HTTP API

This guide provides comprehensive instructions for deploying the Effect-TS HTTP API to AWS using Fargate, API Gateway, and Application Load Balancer.

## Architecture Overview

```
Internet → API Gateway → VPC Link → Application Load Balancer → Fargate Tasks
```

### Components:
- **AWS Fargate**: Serverless container platform running the Effect-TS application
- **Application Load Balancer (ALB)**: Load balances traffic across Fargate tasks
- **API Gateway v2 (HTTP API)**: Provides external API endpoint with CORS, throttling, and monitoring
- **VPC Link**: Securely connects API Gateway to ALB in private subnets
- **Amazon ECR**: Container registry for Docker images
- **CloudWatch**: Logging and monitoring

## Prerequisites

1. **AWS CLI** configured with appropriate permissions
   ```bash
   aws configure
   ```

2. **Docker** installed and running
   ```bash
   docker --version
   ```

3. **AWS CDK** installed globally
   ```bash
   npm install -g aws-cdk
   ```

4. **Node.js** (version 18+) and npm
   ```bash
   node --version
   npm --version
   ```

## Required AWS Permissions

Your AWS user/role needs the following permissions:
- ECR: CreateRepository, PutImage, BatchCheckLayerAvailability
- ECS: CreateCluster, CreateService, RegisterTaskDefinition
- EC2: CreateVpc, CreateSubnet, CreateSecurityGroup, CreateInternetGateway
- IAM: CreateRole, AttachRolePolicy, PassRole
- CloudFormation: CreateStack, UpdateStack, DescribeStacks
- API Gateway: CreateApi, CreateRoute, CreateIntegration
- CloudWatch: CreateLogGroup, PutLogEvents

## Quick Start

1. **Clone and build the project**
   ```bash
   git clone <repository-url>
   cd effect-app
   npm install
   npm run build
   ```

2. **Deploy to AWS**
   ```bash
   ./deploy.sh
   ```

3. **Test the deployment**
   ```bash
   ./test-deployment.sh
   ```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for deployment | `us-west-2` |
| `AWS_ACCOUNT_ID` | AWS account ID | Auto-detected |
| `IMAGE_TAG` | Docker image tag | `latest` |

### Custom Configuration

Edit `infrastructure/lib/effect-app-stack.ts` to customize:

- **Instance sizes**: Modify `memoryLimitMiB` and `cpu` values
- **Auto-scaling**: Adjust `minCapacity`, `maxCapacity`, and scaling policies
- **Health checks**: Customize health check paths and intervals
- **CORS settings**: Update allowed origins, methods, headers

## Deployment Process

The deployment script performs the following steps:

1. **Prerequisites Check**: Validates AWS CLI, Docker, CDK installation
2. **CDK Bootstrap**: Initializes CDK in your AWS account (one-time setup)
3. **ECR Repository**: Creates Amazon ECR repository for container images
4. **Image Build**: Builds and pushes Docker image to ECR
5. **Infrastructure Deploy**: Deploys AWS resources using CDK
6. **Outputs Display**: Shows deployment information and endpoints

## Manual Deployment Steps

If you prefer manual deployment:

1. **Install CDK dependencies**
   ```bash
   cd infrastructure
   npm install
   ```

2. **Bootstrap CDK** (one-time setup per region)
   ```bash
   npx cdk bootstrap
   ```

3. **Create ECR repository**
   ```bash
   aws ecr create-repository --repository-name effect-app
   ```

4. **Build and push image**
   ```bash
   # Build the app
   npm run build
   
   # Login to ECR
   aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com
   
   # Build and push
   docker build -t effect-app .
   docker tag effect-app:latest <account-id>.dkr.ecr.us-west-2.amazonaws.com/effect-app:latest
   docker push <account-id>.dkr.ecr.us-west-2.amazonaws.com/effect-app:latest
   ```

5. **Deploy infrastructure**
   ```bash
   cd infrastructure
   npx cdk deploy
   ```

## Testing the Deployment

### Automated Testing
```bash
./test-deployment.sh
```

### Manual Testing

1. **Get API Gateway URL**
   ```bash
   aws cloudformation describe-stacks --stack-name EffectAppStack --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' --output text
   ```

2. **Test health endpoint**
   ```bash
   curl https://your-api-id.execute-api.us-west-2.amazonaws.com/prod/health
   ```

3. **Test user creation**
   ```bash
   curl -X POST https://your-api-id.execute-api.us-west-2.amazonaws.com/prod/users \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com"}'
   ```

## Monitoring and Troubleshooting

### View Logs
```bash
# Real-time logs
npm run aws:logs

# Or manually
aws logs tail /ecs/effect-app-fargate --follow --region us-west-2
```

### Check Service Status
```bash
aws ecs describe-services --cluster effect-app-cluster --services effect-app-service
```

### Monitor with CloudWatch
- Navigate to CloudWatch in AWS Console
- Check `/ecs/effect-app-fargate` log group
- Monitor ECS service metrics

### Common Issues

1. **Image Not Found**
   - Ensure Docker image is pushed to ECR
   - Verify ECR URI in CDK stack matches pushed image

2. **Service Not Starting**
   - Check CloudWatch logs for startup errors
   - Verify environment variables and port configuration
   - Check security group rules

3. **API Gateway Timeout**
   - Verify ALB health checks are passing
   - Check VPC Link configuration
   - Ensure Fargate tasks are running

## Scaling Configuration

### Horizontal Scaling
The stack includes auto-scaling based on:
- CPU utilization (70% target)
- Memory utilization (80% target)

### Vertical Scaling
To increase instance size, modify in `effect-app-stack.ts`:
```typescript
memoryLimitMiB: 1024,  // Increase from 512
cpu: 512,              // Increase from 256
```

## Security

### Network Security
- Fargate tasks run in private subnets
- Security groups restrict inbound access
- VPC Link provides secure API Gateway connection

### Container Security
- ECR image scanning enabled
- Non-root user in container
- Read-only filesystem where possible

### API Security
- CORS configured for specific origins
- Request throttling enabled
- CloudWatch monitoring for security events

## Cost Optimization

### Fargate Costs
- Right-size CPU and memory allocation
- Use auto-scaling to handle traffic patterns
- Consider scheduled scaling for predictable loads

### API Gateway Costs
- HTTP API is more cost-effective than REST API
- Monitor request volumes and optimize caching

### CloudWatch Costs
- Adjust log retention periods
- Use log filtering to reduce ingestion costs

## Cleanup

To destroy all AWS resources:
```bash
./deploy.sh destroy
```

Or manually:
```bash
cd infrastructure
npx cdk destroy
```

**Note**: This will delete all resources and data. Ensure you have backups if needed.

## Advanced Configuration

### Custom Domain
To use a custom domain:

1. Add domain zone to CDK stack
2. Create SSL certificate
3. Configure API Gateway domain mapping

### Database Integration
For persistent storage:

1. Add RDS or DynamoDB to CDK stack
2. Update environment variables
3. Configure security groups for database access

### CI/CD Integration
For automated deployments:

1. Use GitHub Actions or AWS CodePipeline
2. Store AWS credentials as secrets
3. Trigger deployments on code changes

## Support

For issues or questions:
1. Check CloudWatch logs first
2. Review AWS service status
3. Consult AWS documentation
4. Open an issue in the project repository
