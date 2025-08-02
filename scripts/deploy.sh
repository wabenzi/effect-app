#!/bin/bash

# AWS Deployment Script for Effect-TS Application
# This script builds the Docker image, pushes it to ECR, and deploys the infrastructure

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REPOSITORY_NAME="effect-app"
IMAGE_TAG="${IMAGE_TAG:-latest}"
STACK_NAME="EffectAppStack"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK is not installed. Please install it first: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        log_warning "jq is not installed. Some features may not work properly."
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials are not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Bootstrap CDK if needed
bootstrap_cdk() {
    log_info "Checking CDK bootstrap status..."
    
    # Check if CDK is already bootstrapped
    if aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
        log_info "CDK is already bootstrapped in region $AWS_REGION"
    else
        log_info "Bootstrapping CDK in region $AWS_REGION..."
        cd infrastructure
        npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
        cd ..
        log_success "CDK bootstrap completed"
    fi
}

# Create ECR repository if it doesn't exist
create_ecr_repository() {
    log_info "Checking ECR repository..."
    
    if aws ecr describe-repositories --repository-names $ECR_REPOSITORY_NAME --region $AWS_REGION &> /dev/null; then
        log_info "ECR repository '$ECR_REPOSITORY_NAME' already exists"
    else
        log_info "Creating ECR repository '$ECR_REPOSITORY_NAME'..."
        aws ecr create-repository \
            --repository-name $ECR_REPOSITORY_NAME \
            --region $AWS_REGION \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256
        log_success "ECR repository created"
    fi
}

# Build and push Docker image
build_and_push_image() {
    log_info "Building and pushing Docker image..."
    
    # Build the application
    log_info "Building TypeScript application..."
    npm run build
    
    # Get ECR login token
    log_info "Logging into ECR..."
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
    
    # Build Docker image
    log_info "Building Docker image..."
    docker build -t $ECR_REPOSITORY_NAME:$IMAGE_TAG .
    
    # Tag image for ECR
    ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY_NAME:$IMAGE_TAG"
    docker tag $ECR_REPOSITORY_NAME:$IMAGE_TAG $ECR_URI
    
    # Push image to ECR
    log_info "Pushing image to ECR..."
    docker push $ECR_URI
    
    log_success "Image pushed to ECR: $ECR_URI"
    echo "ECR_URI=$ECR_URI" > .ecr_uri
}

# Update CDK stack with ECR URI
update_cdk_stack() {
    log_info "Updating CDK stack configuration..."
    
    # Read ECR URI
    ECR_URI=$(cat .ecr_uri | cut -d'=' -f2)
    
    # Update the CDK stack to use the ECR image
    sed -i.bak "s|image: ecs.ContainerImage.fromRegistry('effect-app:latest')|image: ecs.ContainerImage.fromRegistry('$ECR_URI')|g" infrastructure/lib/effect-app-stack.ts
    
    log_success "CDK stack updated with ECR URI"
}

# Deploy infrastructure
deploy_infrastructure() {
    log_info "Installing CDK dependencies..."
    cd infrastructure
    npm install
    
    log_info "Deploying infrastructure..."
    npx cdk deploy --require-approval never
    
    log_success "Infrastructure deployed successfully"
    cd ..
}

# Get deployment information
get_deployment_info() {
    log_info "Retrieving deployment information..."
    
    # Get stack outputs
    OUTPUTS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs' --output json)
    
    if [ -n "$OUTPUTS" ] && [ "$OUTPUTS" != "null" ]; then
        echo -e "\n${GREEN}=== Deployment Information ===${NC}"
        
        # Parse and display outputs
        echo "$OUTPUTS" | jq -r '.[] | "\\(.OutputKey): \\(.OutputValue)"' | while read line; do
            echo -e "${BLUE}$line${NC}"
        done
        
        # Get API Gateway URL specifically
        API_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiGatewayUrl") | .OutputValue')
        if [ -n "$API_URL" ] && [ "$API_URL" != "null" ]; then
            echo -e "\n${GREEN}🚀 Your API is available at:${NC}"
            echo -e "${BLUE}$API_URL${NC}"
            echo -e "\n${GREEN}Test endpoints:${NC}"
            echo -e "${BLUE}Health Check: $API_URL/health${NC}"
            echo -e "${BLUE}API Documentation: $API_URL/docs${NC}"
        fi
    else
        log_warning "Could not retrieve stack outputs"
    fi
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    rm -f .ecr_uri
    
    # Restore original CDK file
    if [ -f "infrastructure/lib/effect-app-stack.ts.bak" ]; then
        mv infrastructure/lib/effect-app-stack.ts.bak infrastructure/lib/effect-app-stack.ts
    fi
}

# Main deployment function
deploy() {
    log_info "Starting AWS deployment..."
    
    check_prerequisites
    bootstrap_cdk
    create_ecr_repository
    build_and_push_image
    update_cdk_stack
    deploy_infrastructure
    get_deployment_info
    cleanup
    
    log_success "Deployment completed successfully!"
}

# Destroy function
destroy() {
    log_info "Destroying AWS infrastructure..."
    
    cd infrastructure
    npx cdk destroy --force
    cd ..
    
    log_success "Infrastructure destroyed"
}

# Show help
show_help() {
    echo "AWS Deployment Script for Effect-TS Application"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  deploy     Deploy the application to AWS (default)"
    echo "  destroy    Destroy the AWS infrastructure"
    echo "  help       Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION      AWS region (default: us-west-2)"
    echo "  AWS_ACCOUNT_ID  AWS account ID (auto-detected if not set)"
    echo "  IMAGE_TAG       Docker image tag (default: latest)"
    echo ""
    echo "Examples:"
    echo "  $0 deploy"
    echo "  AWS_REGION=us-east-1 $0 deploy"
    echo "  IMAGE_TAG=v1.0.0 $0 deploy"
    echo "  $0 destroy"
}

# Main script logic
case "${1:-deploy}" in
    deploy)
        deploy
        ;;
    destroy)
        destroy
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
