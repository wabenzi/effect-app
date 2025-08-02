# Test Scripts

This directory contains consolidated test scripts for the Effect-TS API project. These scripts help validate deployments, test API functionality, and ensure the application works correctly in different environments.

## Scripts Overview

### 1. `health-check.sh`
**Purpose**: Quick health endpoint validation with comprehensive response analysis.

**Features**:
- Tests health endpoint with timing and status validation
- JSON response validation (status, timestamp, uptime)
- TLS/HTTPS security validation for HTTPS endpoints
- Support for both AWS CloudFormation discovery and custom URLs

**Usage**:
```bash
# Test AWS deployment (auto-discovers URL from CloudFormation)
./health-check.sh

# Test specific URL
./health-check.sh --url https://api.example.com

# Test local development server
./health-check.sh --url http://localhost:3000

# Use custom stack name
./health-check.sh --stack-name MyStack --region us-east-1
```

### 2. `api-test.sh`
**Purpose**: Comprehensive API endpoint testing with load testing capabilities.

**Features**:
- Full API endpoint testing with curl
- Load testing with concurrent requests
- Verbose logging for debugging
- Health-only mode for quick checks
- Support for future API endpoints

**Usage**:
```bash
# Full API test with AWS discovery
./api-test.sh

# Quick health check only
./api-test.sh --health-only

# Include load testing
./api-test.sh --load-test

# Test specific URL with verbose output
./api-test.sh --base-url https://api.example.com --verbose

# Test local server
./api-test.sh --base-url http://localhost:3000
```

### 3. `deployment-test.sh`
**Purpose**: AWS CloudFormation deployment validation and infrastructure testing.

**Features**:
- CloudFormation stack status validation
- ECS service health checking
- Stack outputs parsing (API Gateway, Load Balancer URLs)
- Endpoint connectivity testing
- AWS CLI configuration validation

**Usage**:
```bash
# Full deployment test
./deployment-test.sh

# Quick test (skip detailed ECS checks)
./deployment-test.sh --quick

# Test specific stack
./deployment-test.sh --stack-name MyStack --region us-east-1

# Custom timeout
./deployment-test.sh --timeout 600
```

### 4. `integration-test.sh`
**Purpose**: Integration testing across local development and AWS environments.

**Features**:
- Tests both local development server and AWS deployment
- Response comparison between environments
- Flexible testing modes (local-only, AWS-only, both)
- CORS header validation
- 404 endpoint testing

**Usage**:
```bash
# Test both local and AWS
./integration-test.sh

# Test only local development server
./integration-test.sh --local-only

# Test only AWS deployment
./integration-test.sh --aws-only

# Custom local URL
./integration-test.sh --local-url http://localhost:8080
```

## Script Selection Guide

| Use Case | Recommended Script | Options |
|----------|-------------------|---------|
| Quick health check | `health-check.sh` | `--url` for custom URL |
| API functionality testing | `api-test.sh` | `--load-test` for performance |
| Deployment validation | `deployment-test.sh` | `--quick` for fast check |
| Compare local vs AWS | `integration-test.sh` | Default (tests both) |
| Performance testing | `api-test.sh` | `--load-test` |
| Local development | `integration-test.sh` | `--local-only` |

## Dependencies

### Required
- `curl` - For HTTP requests
- `bash` - Shell environment

### For AWS Testing
- `aws` - AWS CLI v2
- Configured AWS credentials (`aws configure`)
- Deployed CloudFormation stack

### Optional
- `jq` - For JSON response validation
- `bc` - For load testing calculations

## Environment Variables

- `AWS_REGION` - Default AWS region (default: us-west-2)
- `LOAD_TEST` - Enable load testing in api-test.sh (true/false)

## Common Issues

### AWS CLI Not Found
```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

### AWS Credentials Not Configured
```bash
aws configure
```

### Stack Not Found
Ensure your CloudFormation stack is deployed:
```bash
cd infrastructure
cdk deploy
```

### Local Server Not Running
Start the development server:
```bash
npm run dev
# or
npm start
```

## Examples

### Quick Health Check
```bash
# Test current AWS deployment
./test/scripts/health-check.sh

# Test local development
./test/scripts/health-check.sh --url http://localhost:3000
```

### Full Deployment Validation
```bash
# Complete deployment test
./test/scripts/deployment-test.sh

# Follow with API testing
./test/scripts/api-test.sh --load-test
```

### Development Workflow
```bash
# Test local development
./test/scripts/integration-test.sh --local-only

# Deploy to AWS
cd infrastructure && cdk deploy

# Test deployment
./test/scripts/deployment-test.sh

# Compare local vs AWS
./test/scripts/integration-test.sh
```

## Troubleshooting

### High Response Times
- Check AWS region latency
- Verify ECS task health
- Review CloudWatch logs

### 503 Errors from API Gateway
- Verify VPC Link configuration
- Check security group rules
- Ensure ECS tasks are healthy

### Connection Timeouts
- Verify network connectivity
- Check AWS credentials
- Ensure stack is deployed in correct region

## Migration Notes

These scripts consolidate and replace the following original scripts:
- `test-aws-comprehensive.sh` → `health-check.sh`
- `test-deployment-working.sh` → `health-check.sh`
- `test-curl.sh` → `api-test.sh`
- `test-aws-curl.sh` → `api-test.sh`
- `test-deployment.sh` → `deployment-test.sh`
- `test-deployment-simple.sh` → `deployment-test.sh`
- `test-integration-complete.sh` → `integration-test.sh`
