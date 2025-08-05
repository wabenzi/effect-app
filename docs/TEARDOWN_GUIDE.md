# 🗑️ AWS Infrastructure Teardown Guide

This guide covers the comprehensive teardown script for safely removing all AWS infrastructure deployed for the Effect-TS application.

## 📋 Quick Reference

### NPM Scripts
```bash
# Interactive teardown (recommended)
npm run aws:teardown

# Force teardown without confirmation
npm run aws:teardown:force

# Complete teardown including local Docker cleanup
npm run aws:teardown:clean
```

### Direct Script Usage
```bash
# Interactive teardown
./scripts/teardown.sh

# Force teardown
./scripts/teardown.sh --force

# Teardown with Docker cleanup
./scripts/teardown.sh --clean-docker

# Custom region/stack
./scripts/teardown.sh --region us-east-1 --stack MyStack
```

## 🏗️ Resources Removed

The teardown script will remove the following AWS resources:

### Core Infrastructure
- ✅ **CloudFormation Stack** (`EffectAppStack-v2`)
- ✅ **ECS Fargate** services, tasks, and clusters
- ✅ **Application Load Balancer** and target groups
- ✅ **API Gateway** REST API and endpoints

### Container & Storage
- ✅ **ECR Repository** (`effect-app`) and all container images
- ✅ **CloudWatch Log Groups** (`/ecs/effect-app*`)

### Networking
- ✅ **VPC** (Virtual Private Cloud)
- ✅ **Subnets** (public and private)
- ✅ **Internet Gateway**
- ✅ **Security Groups**
- ✅ **Route Tables**

### Local Cleanup (Optional)
- 🐳 **Local Docker Images** (when `--clean-docker` used)
- 📁 **CDK Output Directories** (`cdk.out/`)

## 🚨 Safety Features

### Confirmation Required
The script requires explicit confirmation unless `--force` is used:
```text
⚠️  WARNING: This will permanently delete ALL AWS resources!

Resources to be deleted:
  🏗️  CloudFormation Stack: EffectAppStack-v2
  📦 ECR Repository: effect-app (and all images)
  📊 CloudWatch Log Groups: /ecs/effect-app*
  🌐 API Gateway endpoints
  ⚖️  Load Balancers and Target Groups
  🐳 ECS Services and Tasks
  🔒 Security Groups and VPC resources

Are you sure you want to proceed? (type 'DELETE' to confirm):
```

### Prerequisites Check
- ✅ AWS CLI installation
- ✅ AWS credentials configuration
- ✅ Account access verification

### Verification Steps
After teardown, the script verifies:
- ✅ CloudFormation stack deleted
- ✅ ECR repository removed
- ✅ Log groups cleaned up

## 📊 Generated Reports

Each teardown generates a timestamped report:

**File:** `teardown-report-YYYYMMDD_HHMMSS.txt`

**Contents:**
```
========================================
AWS INFRASTRUCTURE TEARDOWN REPORT
========================================
Timestamp: Fri Aug  1 20:57:45 PDT 2025
AWS Account: 822812326070
Region: us-west-2

Resources Removed:
✅ CloudFormation Stack: EffectAppStack-v2
✅ ECR Repository: effect-app
✅ CloudWatch Log Groups: /ecs/effect-app*
...

Cost Impact:
- All billable AWS resources removed
- No ongoing charges for Effect-TS infrastructure
========================================
```

## 🔧 Advanced Usage

### Environment Variables
```bash
# Force delete without confirmation
FORCE_DELETE=true ./scripts/teardown.sh

# Clean Docker images
CLEAN_DOCKER=true ./scripts/teardown.sh

# Custom region
AWS_REGION=us-east-1 ./scripts/teardown.sh
```

### Custom Configuration
```bash
# Different stack name
./scripts/teardown.sh --stack MyCustomStack

# Different ECR repository
./scripts/teardown.sh --repo my-app

# Multiple options
./scripts/teardown.sh --force --clean-docker --region us-east-1
```

## ⚠️ Important Considerations

### Data Loss Warning
- **PERMANENT DELETION**: All AWS resources will be permanently removed
- **Container Images**: All Docker images in ECR will be deleted
- **Log Data**: CloudWatch logs will be permanently lost
- **Database**: If RDS/DynamoDB used, data will be lost

### Cost Implications
- **Immediate**: All billable resources stop incurring charges
- **Final Bills**: May see final charges for partial hours/months
- **Storage**: EBS snapshots, if any, may continue to incur charges

### Recovery
- **No Rollback**: Once deleted, resources cannot be recovered
- **Redeployment**: Use `npm run aws:deploy` to redeploy
- **Data Restoration**: Requires separate backup/restore procedures

## 🔄 Redeployment After Teardown

After teardown, to redeploy:

1. **Fix Security Issues** (if any)
   ```bash
   npm run test:security
   ```

2. **Deploy Infrastructure**
   ```bash
   npm run aws:deploy
   ```

3. **Verify Deployment**
   ```bash
   npm run aws:status
   npm run aws:test
   ```

## 🐛 Troubleshooting

### Common Issues

**Stack Deletion Stuck**
```bash
# Check stack events
aws cloudformation describe-stack-events --stack-name EffectAppStack-v2

# Force delete after reviewing
./scripts/teardown.sh --force
```

**ECR Repository Access Denied**
```bash
# Check permissions
aws ecr describe-repositories --repository-names effect-app

# Manual deletion
aws ecr delete-repository --repository-name effect-app --force
```

**Log Groups Remain**
```bash
# List remaining log groups
aws logs describe-log-groups --log-group-name-prefix "/ecs/effect-app"

# Manual cleanup
aws logs delete-log-group --log-group-name "/ecs/effect-app-fargate"
```

### Script Failures

**AWS CLI Not Found**
```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Credentials Not Configured**
```bash
# Configure AWS credentials
aws configure
```

**Insufficient Permissions**
```bash
# Required permissions:
- cloudformation:*
- ecr:*
- logs:*
- ecs:*
- ec2:*
- elasticloadbalancing:*
- apigateway:*
```

## 📋 Checklist

Before running teardown:
- [ ] Backup any important data
- [ ] Document current configuration
- [ ] Verify you have the correct AWS account/region
- [ ] Ensure no critical services depend on this infrastructure
- [ ] Review the security assessment before redeployment

After teardown:
- [ ] Verify all resources deleted via AWS Console
- [ ] Review teardown report
- [ ] Address any security issues before redeployment
- [ ] Update documentation if needed

## 🆘 Emergency Recovery

If you need to emergency stop a teardown in progress:

1. **Cancel CloudFormation Deletion**
   ```bash
   aws cloudformation cancel-update-stack --stack-name EffectAppStack-v2
   ```

2. **Check Resource States**
   ```bash
   aws cloudformation describe-stack-resources --stack-name EffectAppStack-v2
   ```

3. **Manual Resource Recovery**
   - Resources already deleted cannot be recovered
   - Partially deleted stack may need manual cleanup
   - Consider creating new deployment instead
