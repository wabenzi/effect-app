#!/bin/bash

# AWS Infrastructure Teardown Script for Effect-TS Application
# This script safely removes all AWS resources and cleans up local artifacts

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="${STACK_NAME:-EffectAppStack-v2}"
ECR_REPOSITORY_NAME="${ECR_REPOSITORY_NAME:-effect-app}"
LOG_GROUP_PREFIX="/ecs/effect-app"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Banner
show_banner() {
    echo -e "${CYAN}"
    echo "=========================================="
    echo "🗑️  AWS INFRASTRUCTURE TEARDOWN SCRIPT"
    echo "=========================================="
    echo -e "${NC}"
    echo "Application: Effect-TS HTTP Server"
    echo "Region: $AWS_REGION"
    echo "Stack: $STACK_NAME"
    echo "Repository: $ECR_REPOSITORY_NAME"
    echo ""
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    # Get AWS Account ID
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    log_info "AWS Account ID: $AWS_ACCOUNT_ID"
    log_info "AWS Region: $AWS_REGION"
    
    log_success "Prerequisites check completed"
}

# Confirm teardown
confirm_teardown() {
    echo ""
    log_warning "⚠️  WARNING: This will permanently delete ALL AWS resources!"
    echo ""
    echo "Resources to be deleted:"
    echo "  🏗️  CloudFormation Stack: $STACK_NAME"
    echo "  📦 ECR Repository: $ECR_REPOSITORY_NAME (and all images)"
    echo "  📊 CloudWatch Log Groups: $LOG_GROUP_PREFIX*"
    echo "  🌐 API Gateway endpoints"
    echo "  ⚖️  Load Balancers and Target Groups"
    echo "  🐳 ECS Services and Tasks"
    echo "  🔒 Security Groups and VPC resources"
    echo ""
    
    if [[ "${FORCE_DELETE:-}" == "true" ]]; then
        log_info "Force delete enabled, proceeding without confirmation..."
        return 0
    fi
    
    read -p "Are you sure you want to proceed? (type 'DELETE' to confirm): " confirmation
    if [[ "$confirmation" != "DELETE" ]]; then
        log_info "Teardown cancelled by user"
        exit 0
    fi
}

# Check if stack exists
check_stack_exists() {
    log_step "Checking if CloudFormation stack exists..."
    
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" &> /dev/null; then
        STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)
        log_info "Stack found with status: $STACK_STATUS"
        return 0
    else
        log_warning "Stack $STACK_NAME not found"
        return 1
    fi
}

# Delete CloudFormation stack
delete_cloudformation_stack() {
    if check_stack_exists; then
        log_step "Deleting CloudFormation stack: $STACK_NAME"
        
        # Check if stack is in a deletable state
        if [[ "$STACK_STATUS" == *"IN_PROGRESS"* ]]; then
            log_warning "Stack is in $STACK_STATUS state. Waiting for operation to complete..."
            aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" --region "$AWS_REGION" || true
        fi
        
        # Start deletion
        log_info "Initiating stack deletion..."
        aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$AWS_REGION"
        
        # Wait for deletion to complete
        log_info "Waiting for stack deletion to complete (this may take several minutes)..."
        aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$AWS_REGION"
        
        log_success "CloudFormation stack deleted successfully"
    else
        log_info "No CloudFormation stack to delete"
    fi
}

# Delete ECR repository
delete_ecr_repository() {
    log_step "Checking ECR repository: $ECR_REPOSITORY_NAME"
    
    if aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$ECR_REPOSITORY_NAME" &> /dev/null; then
        log_info "ECR repository found. Deleting repository and all images..."
        
        # Get image count
        IMAGE_COUNT=$(aws ecr list-images --region "$AWS_REGION" --repository-name "$ECR_REPOSITORY_NAME" --query 'length(imageIds)' --output text)
        log_info "Found $IMAGE_COUNT container images to delete"
        
        # Delete repository with force (removes all images)
        aws ecr delete-repository --region "$AWS_REGION" --repository-name "$ECR_REPOSITORY_NAME" --force
        
        log_success "ECR repository and $IMAGE_COUNT images deleted successfully"
    else
        log_info "No ECR repository to delete"
    fi
}

# Delete CloudWatch log groups
delete_cloudwatch_logs() {
    log_step "Checking CloudWatch log groups with prefix: $LOG_GROUP_PREFIX"
    
    LOG_GROUPS=$(aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix "$LOG_GROUP_PREFIX" --query 'logGroups[].logGroupName' --output text)
    
    if [[ -n "$LOG_GROUPS" && "$LOG_GROUPS" != "None" ]]; then
        log_info "Found log groups to delete:"
        echo "$LOG_GROUPS" | tr '\t' '\n' | while read -r log_group; do
            if [[ -n "$log_group" ]]; then
                echo "  📊 $log_group"
                aws logs delete-log-group --region "$AWS_REGION" --log-group-name "$log_group"
            fi
        done
        log_success "CloudWatch log groups deleted successfully"
    else
        log_info "No CloudWatch log groups to delete"
    fi
}

# Clean up local artifacts
cleanup_local_artifacts() {
    log_step "Cleaning up local artifacts..."
    
    # Remove CDK output directory
    if [[ -d "cdk.out" ]]; then
        log_info "Removing CDK output directory..."
        rm -rf cdk.out
    fi
    
    if [[ -d "infrastructure/cdk.out" ]]; then
        log_info "Removing infrastructure CDK output directory..."
        rm -rf infrastructure/cdk.out
    fi
    
    # Remove local Docker images (optional)
    if command -v docker &> /dev/null; then
        log_info "Checking for local Docker images..."
        if docker images | grep -q "$ECR_REPOSITORY_NAME"; then
            log_info "Found local Docker images for $ECR_REPOSITORY_NAME"
            if [[ "${CLEAN_DOCKER:-}" == "true" ]]; then
                log_info "Removing local Docker images..."
                docker rmi $(docker images | grep "$ECR_REPOSITORY_NAME" | awk '{print $3}') 2>/dev/null || true
                log_success "Local Docker images cleaned up"
            else
                log_warning "To clean up local Docker images, run with CLEAN_DOCKER=true"
            fi
        fi
    fi
    
    log_success "Local artifacts cleanup completed"
}

# Verify teardown
verify_teardown() {
    log_step "Verifying teardown completion..."
    
    # Check CloudFormation stack
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" &> /dev/null; then
        log_error "CloudFormation stack still exists!"
        return 1
    else
        log_success "✅ CloudFormation stack successfully removed"
    fi
    
    # Check ECR repository
    if aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$ECR_REPOSITORY_NAME" &> /dev/null; then
        log_error "ECR repository still exists!"
        return 1
    else
        log_success "✅ ECR repository successfully removed"
    fi
    
    # Check log groups
    LOG_GROUPS=$(aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix "$LOG_GROUP_PREFIX" --query 'logGroups[].logGroupName' --output text)
    if [[ -n "$LOG_GROUPS" && "$LOG_GROUPS" != "None" ]]; then
        log_warning "⚠️  Some log groups may still exist: $LOG_GROUPS"
    else
        log_success "✅ CloudWatch log groups successfully removed"
    fi
    
    log_success "Teardown verification completed"
}

# Generate teardown report
generate_report() {
    log_step "Generating teardown report..."
    
    REPORT_FILE="teardown-report-$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$REPORT_FILE" << EOF
========================================
AWS INFRASTRUCTURE TEARDOWN REPORT
========================================
Timestamp: $(date)
AWS Account: $AWS_ACCOUNT_ID
Region: $AWS_REGION

Resources Removed:
✅ CloudFormation Stack: $STACK_NAME
✅ ECR Repository: $ECR_REPOSITORY_NAME
✅ CloudWatch Log Groups: $LOG_GROUP_PREFIX*
✅ ECS Services and Tasks
✅ Application Load Balancer and Target Groups
✅ API Gateway endpoints
✅ VPC, Subnets, Security Groups

Verification:
- Stack Status: DELETED
- ECR Repository: DELETED
- Log Groups: CLEANED

Cost Impact:
- All billable AWS resources removed
- No ongoing charges for Effect-TS infrastructure

Next Steps:
1. Review security issues in SECURITY_ASSESSMENT.md
2. Fix critical vulnerabilities before redeployment
3. Run 'npm run test:security' before next deployment
4. Use 'npm run aws:deploy' to redeploy when ready

Report generated: $REPORT_FILE
========================================
EOF
    
    log_success "Teardown report generated: $REPORT_FILE"
}

# Main execution
main() {
    show_banner
    check_prerequisites
    confirm_teardown
    
    echo ""
    log_info "🚀 Starting AWS infrastructure teardown..."
    echo ""
    
    # Execute teardown steps
    delete_cloudformation_stack
    delete_ecr_repository
    delete_cloudwatch_logs
    cleanup_local_artifacts
    
    echo ""
    log_info "🔍 Verifying teardown completion..."
    verify_teardown
    
    echo ""
    log_info "📋 Generating teardown report..."
    generate_report
    
    echo ""
    log_success "🎉 AWS infrastructure teardown completed successfully!"
    echo ""
    log_info "💡 Next steps:"
    echo "   1. Address security vulnerabilities in SECURITY_ASSESSMENT.md"
    echo "   2. Run 'npm run test:security' before redeployment"
    echo "   3. Use 'npm run aws:deploy' when ready to redeploy"
    echo ""
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --force         Skip confirmation prompt"
    echo "  --clean-docker  Remove local Docker images"
    echo "  --region REGION Set AWS region (default: us-west-2)"
    echo "  --stack NAME    Set stack name (default: EffectAppStack-v2)"
    echo "  --repo NAME     Set ECR repository name (default: effect-app)"
    echo "  --help          Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  FORCE_DELETE=true    Skip confirmation"
    echo "  CLEAN_DOCKER=true    Remove local Docker images"
    echo "  AWS_REGION           AWS region override"
    echo ""
    echo "Examples:"
    echo "  $0                   Interactive teardown"
    echo "  $0 --force           Force teardown without confirmation"
    echo "  $0 --clean-docker    Teardown and clean local Docker images"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            export FORCE_DELETE=true
            shift
            ;;
        --clean-docker)
            export CLEAN_DOCKER=true
            shift
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --stack)
            STACK_NAME="$2"
            shift 2
            ;;
        --repo)
            ECR_REPOSITORY_NAME="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Run main function
main "$@"
