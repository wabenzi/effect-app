#!/bin/bash

# Deployment Testing Script for Effect-TS API
# Tests AWS CloudFormation deployment status and endpoints
# Consolidates functionality from test-deployment.sh and test-deployment-simple.sh

set -e

# Configuration
STACK_NAME="EffectAppStack-v2"
AWS_REGION="${AWS_REGION:-us-west-2}"
DETAILED_CHECK=true
TIMEOUT=300

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

# Show help
show_help() {
    echo "Deployment Testing Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --stack-name NAME     CloudFormation stack name (default: $STACK_NAME)"
    echo "  --region REGION       AWS region (default: $AWS_REGION)"
    echo "  --quick              Skip detailed checks, only test basic functionality"
    echo "  --timeout SECONDS    Timeout for deployment checks (default: $TIMEOUT)"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Full deployment test"
    echo "  $0 --quick                   # Quick basic test"
    echo "  $0 --stack-name MyStack      # Test specific stack"
}

# Check if AWS CLI is available
check_aws_cli() {
    if ! command -v aws >/dev/null 2>&1; then
        log_error "AWS CLI is not installed or not in PATH"
        log_error "Please install AWS CLI: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured"
        log_error "Please run: aws configure"
        exit 1
    fi
    
    log_success "AWS CLI is configured"
}

# Check CloudFormation stack status
check_stack_status() {
    log_info "Checking CloudFormation stack: $STACK_NAME"
    
    local stack_status
    stack_status=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    case $stack_status in
        "CREATE_COMPLETE"|"UPDATE_COMPLETE")
            log_success "Stack status: $stack_status"
            return 0
            ;;
        "CREATE_IN_PROGRESS"|"UPDATE_IN_PROGRESS")
            log_warning "Stack status: $stack_status (deployment in progress)"
            return 1
            ;;
        "ROLLBACK_COMPLETE"|"UPDATE_ROLLBACK_COMPLETE")
            log_error "Stack status: $stack_status (deployment failed)"
            return 1
            ;;
        "NOT_FOUND")
            log_error "Stack not found: $STACK_NAME"
            return 1
            ;;
        *)
            log_warning "Stack status: $stack_status"
            return 1
            ;;
    esac
}

# Get stack outputs
get_stack_outputs() {
    log_info "Retrieving stack outputs..."
    
    local outputs
    outputs=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs' \
        --output json 2>/dev/null)
    
    if [ -z "$outputs" ] || [ "$outputs" = "null" ]; then
        log_warning "No stack outputs found"
        return 1
    fi
    
    # Parse outputs
    API_URL=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="ApiGatewayUrl") | .OutputValue' 2>/dev/null || echo "")
    ALB_URL=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="LoadBalancerUrl") | .OutputValue' 2>/dev/null || echo "")
    
    if [ -n "$API_URL" ]; then
        log_success "API Gateway URL: $API_URL"
    fi
    
    if [ -n "$ALB_URL" ]; then
        log_success "Load Balancer URL: $ALB_URL"
    fi
    
    if [ -z "$API_URL" ] && [ -z "$ALB_URL" ]; then
        log_error "No API or Load Balancer URLs found in stack outputs"
        return 1
    fi
    
    return 0
}

# Check ECS service status
check_ecs_service() {
    if [ "$DETAILED_CHECK" = false ]; then
        return 0
    fi
    
    log_info "Checking ECS service status..."
    
    # Get cluster name from stack resources
    local cluster_name
    cluster_name=$(aws cloudformation list-stack-resources \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'StackResourceSummaries[?ResourceType==`AWS::ECS::Cluster`].PhysicalResourceId' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$cluster_name" ]; then
        log_warning "Could not find ECS cluster in stack"
        return 1
    fi
    
    # Get service name
    local service_name
    service_name=$(aws cloudformation list-stack-resources \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'StackResourceSummaries[?ResourceType==`AWS::ECS::Service`].PhysicalResourceId' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$service_name" ]; then
        log_warning "Could not find ECS service in stack"
        return 1
    fi
    
    # Check service status
    local service_status
    service_status=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region $AWS_REGION \
        --query 'services[0].status' \
        --output text 2>/dev/null || echo "")
    
    local running_count
    running_count=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region $AWS_REGION \
        --query 'services[0].runningCount' \
        --output text 2>/dev/null || echo "0")
    
    local desired_count
    desired_count=$(aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region $AWS_REGION \
        --query 'services[0].desiredCount' \
        --output text 2>/dev/null || echo "0")
    
    if [ "$service_status" = "ACTIVE" ] && [ "$running_count" = "$desired_count" ] && [ "$running_count" -gt 0 ]; then
        log_success "ECS service: $service_status ($running_count/$desired_count tasks running)"
        return 0
    else
        log_warning "ECS service: $service_status ($running_count/$desired_count tasks running)"
        return 1
    fi
}

# Test endpoint connectivity
test_endpoints() {
    log_info "Testing endpoint connectivity..."
    
    local test_passed=true
    
    # Test API Gateway if available
    if [ -n "$API_URL" ]; then
        log_info "Testing API Gateway endpoint..."
        local health_url="$API_URL/health"
        local response_code
        response_code=$(curl -s -w "%{http_code}" -o /dev/null "$health_url" --max-time 30 || echo "000")
        
        if [ "$response_code" = "200" ]; then
            log_success "API Gateway health check: HTTP $response_code"
        else
            log_error "API Gateway health check failed: HTTP $response_code"
            test_passed=false
        fi
    fi
    
    # Test Load Balancer if available (detailed check only)
    if [ -n "$ALB_URL" ] && [ "$DETAILED_CHECK" = true ]; then
        log_info "Testing Load Balancer endpoint..."
        local alb_health_url="$ALB_URL/health"
        local alb_response_code
        alb_response_code=$(curl -s -w "%{http_code}" -o /dev/null "$alb_health_url" --max-time 30 || echo "000")
        
        if [ "$alb_response_code" = "200" ]; then
            log_success "Load Balancer health check: HTTP $alb_response_code"
        else
            log_warning "Load Balancer health check: HTTP $alb_response_code (may be internal only)"
        fi
    fi
    
    if [ "$test_passed" = true ]; then
        return 0
    else
        return 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --quick)
            DETAILED_CHECK=false
            shift
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            log_error "Unexpected argument: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
echo "🚀 Deployment Testing for Effect-TS API"
echo "========================================"
echo "Stack: $STACK_NAME"
echo "Region: $AWS_REGION"
echo "Detailed checks: $DETAILED_CHECK"
echo ""

# Run tests
check_aws_cli

if ! check_stack_status; then
    log_error "Stack is not in a ready state"
    exit 1
fi

if ! get_stack_outputs; then
    log_error "Could not retrieve stack outputs"
    exit 1
fi

if [ "$DETAILED_CHECK" = true ]; then
    check_ecs_service
fi

if ! test_endpoints; then
    log_error "Endpoint tests failed"
    exit 1
fi

log_success "Deployment testing completed successfully!"
echo ""
echo "✅ Your Effect-TS API is deployed and accessible"
if [ -n "$API_URL" ]; then
    echo "🌐 API Gateway: $API_URL"
fi
if [ -n "$ALB_URL" ] && [ "$DETAILED_CHECK" = true ]; then
    echo "⚖️  Load Balancer: $ALB_URL"
fi
