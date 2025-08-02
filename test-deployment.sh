#!/bin/bash

# Test script for deployed Effect-TS application on AWS
# This script tests the deployed API endpoints

set -e

# Configuration
STACK_NAME="EffectAppStack"
AWS_REGION="${AWS_REGION:-us-west-2}"

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

# Get API Gateway URL from CloudFormation stack
get_api_url() {
    log_info "Retrieving API Gateway URL from CloudFormation..."
    
    API_URL=$(aws cloudformation describe-stacks 
        --stack-name $STACK_NAME 
        --region $AWS_REGION 
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' 
        --output text)
    
    if [ -z "$API_URL" ] || [ "$API_URL" == "None" ]; then
        log_error "Could not retrieve API Gateway URL from stack $STACK_NAME"
        exit 1
    fi
    
    log_success "API Gateway URL: $API_URL"
    echo "$API_URL"
}

# Test health endpoint
test_health() {
    local api_url=$1
    log_info "Testing health endpoint..."
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" "$api_url/health")
    http_code=$(echo $response | tr -d '
' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo $response | sed -e 's/HTTPSTATUS\:.*//g')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Health check passed"
        echo "Response: $body"
        return 0
    else
        log_error "Health check failed with status $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test user creation
test_user_creation() {
    local api_url=$1
    log_info "Testing user creation..."
    
    timestamp=$(date +%s)
    email="aws-test-${timestamp}@example.com"
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" 
        -X POST 
        -H "Content-Type: application/json" 
        -d "{"email":"$email"}" 
        "$api_url/users")
    
    http_code=$(echo $response | tr -d '
' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo $response | sed -e 's/HTTPSTATUS\:.*//g')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "User creation passed"
        echo "Created user: $email"
        
        # Extract session cookie from response headers
        set_cookie=$(curl -s -I -X POST 
            -H "Content-Type: application/json" 
            -d "{"email":"$email"}" 
            "$api_url/users" | grep -i "set-cookie" | grep "token=" | head -1)
        
        if [ -n "$set_cookie" ]; then
            session_cookie=$(echo "$set_cookie" | sed 's/.*token=\([^;]*\).*/token=\1/')
            echo "SESSION_COOKIE=$session_cookie" > .session_cookie
            log_success "Session cookie extracted: $session_cookie"
        else
            log_warning "Could not extract session cookie"
        fi
        
        return 0
    else
        log_error "User creation failed with status $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test authenticated group creation
test_group_creation() {
    local api_url=$1
    log_info "Testing authenticated group creation..."
    
    if [ ! -f ".session_cookie" ]; then
        log_error "No session cookie found. Run user creation test first."
        return 1
    fi
    
    session_cookie=$(cat .session_cookie | cut -d'=' -f2-)
    timestamp=$(date +%s)
    group_name="AWS Test Group $timestamp"
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" 
        -X POST 
        -H "Content-Type: application/json" 
        -H "Cookie: $session_cookie" 
        -d "{"name":"$group_name"}" 
        "$api_url/groups")
    
    http_code=$(echo $response | tr -d '
' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo $response | sed -e 's/HTTPSTATUS\:.*//g')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Group creation passed"
        echo "Created group: $group_name"
        echo "Response: $body"
        return 0
    else
        log_error "Group creation failed with status $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Test unauthenticated request
test_unauthenticated_request() {
    local api_url=$1
    log_info "Testing unauthenticated request rejection..."
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" 
        -X GET 
        "$api_url/users/me")
    
    http_code=$(echo $response | tr -d '
' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo $response | sed -e 's/HTTPSTATUS\:.*//g')
    
    if [ "$http_code" -eq 403 ]; then
        log_success "Unauthenticated request properly rejected"
        return 0
    else
        log_error "Unauthenticated request should return 403, got $http_code"
        echo "Response: $body"
        return 1
    fi
}

# Run load test
run_load_test() {
    local api_url=$1
    local duration=${2:-30}
    local concurrency=${3:-10}
    
    log_info "Running load test for ${duration}s with ${concurrency} concurrent requests..."
    
    if command -v apache2-utils &> /dev/null || command -v ab &> /dev/null; then
        ab -t $duration -c $concurrency "$api_url/health" | grep -E "(Requests per second|Time per request|Transfer rate)"
        log_success "Load test completed"
    else
        log_warning "Apache Bench (ab) not found. Skipping load test."
        log_info "Install with: sudo apt-get install apache2-utils (Ubuntu) or brew install apache2 (macOS)"
    fi
}

# Check CloudWatch logs
check_logs() {
    log_info "Checking recent CloudWatch logs..."
    
    log_group_name="/ecs/effect-app-fargate"
    
    # Get the most recent log stream
    latest_stream=$(aws logs describe-log-streams 
        --log-group-name $log_group_name 
        --region $AWS_REGION 
        --order-by LastEventTime 
        --descending 
        --max-items 1 
        --query 'logStreams[0].logStreamName' 
        --output text 2>/dev/null)
    
    if [ -n "$latest_stream" ] && [ "$latest_stream" != "None" ]; then
        log_info "Latest log stream: $latest_stream"
        
        # Get recent log events
        aws logs get-log-events 
            --log-group-name $log_group_name 
            --log-stream-name "$latest_stream" 
            --region $AWS_REGION 
            --start-time $(($(date +%s) * 1000 - 300000)) 
            --query 'events[*].message' 
            --output text | tail -10
    else
        log_warning "No log streams found or CloudWatch logs not accessible"
    fi
}

# Get deployment status
get_deployment_status() {
    log_info "Checking deployment status..."
    
    # Check ECS service status
    cluster_name=$(aws cloudformation describe-stacks 
        --stack-name $STACK_NAME 
        --region $AWS_REGION 
        --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' 
        --output text)
    
    service_name=$(aws cloudformation describe-stacks 
        --stack-name $STACK_NAME 
        --region $AWS_REGION 
        --query 'Stacks[0].Outputs[?OutputKey==`ServiceName`].OutputValue' 
        --output text)
    
    if [ -n "$cluster_name" ] && [ -n "$service_name" ]; then
        log_info "ECS Cluster: $cluster_name"
        log_info "ECS Service: $service_name"
        
        # Get service status
        service_status=$(aws ecs describe-services 
            --cluster $cluster_name 
            --services $service_name 
            --region $AWS_REGION 
            --query 'services[0].status' 
            --output text)
        
        running_count=$(aws ecs describe-services 
            --cluster $cluster_name 
            --services $service_name 
            --region $AWS_REGION 
            --query 'services[0].runningCount' 
            --output text)
        
        desired_count=$(aws ecs describe-services 
            --cluster $cluster_name 
            --services $service_name 
            --region $AWS_REGION 
            --query 'services[0].desiredCount' 
            --output text)
        
        log_info "Service Status: $service_status"
        log_info "Running Tasks: $running_count/$desired_count"
        
        if [ "$service_status" = "ACTIVE" ] && [ "$running_count" -eq "$desired_count" ] && [ "$running_count" -gt 0 ]; then
            log_success "ECS service is healthy"
        else
            log_warning "ECS service may not be fully healthy"
        fi
    fi
}

# Cleanup function
cleanup() {
    rm -f .session_cookie
}

# Main test function
run_tests() {
    log_info "Starting AWS deployment tests..."
    
    API_URL=$(get_api_url)
    
    # Run deployment status check
    get_deployment_status
    
    echo -e "
${GREEN}=== Running API Tests ===${NC}"
    
    # Run tests
    test_health "$API_URL" || exit 1
    test_user_creation "$API_URL" || exit 1
    test_group_creation "$API_URL" || exit 1
    test_unauthenticated_request "$API_URL" || exit 1
    
    echo -e "
${GREEN}=== Additional Checks ===${NC}"
    
    # Optional load test
    if [ "${LOAD_TEST:-false}" = "true" ]; then
        run_load_test "$API_URL" 30 5
    fi
    
    # Check logs
    check_logs
    
    cleanup
    
    echo -e "
${GREEN}🎉 All tests passed! Your AWS deployment is working correctly.${NC}"
    echo -e "${BLUE}API Gateway URL: $API_URL${NC}"
}

# Show help
show_help() {
    echo "AWS Deployment Test Script for Effect-TS Application"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --load-test    Run load testing (requires apache2-utils)"
    echo "  --logs-only    Only check CloudWatch logs"
    echo "  --status-only  Only check deployment status"
    echo "  --help         Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION     AWS region (default: us-west-2)"
    echo "  LOAD_TEST      Set to 'true' to enable load testing"
    echo ""
    echo "Examples:"
    echo "  $0                           # Run all tests"
    echo "  LOAD_TEST=true $0            # Run tests with load testing"
    echo "  $0 --logs-only               # Only check logs"
    echo "  AWS_REGION=us-east-1 $0      # Test in different region"
}

# Main script logic
case "${1:-test}" in
    test|"")
        run_tests
        ;;
    --logs-only)
        check_logs
        ;;
    --status-only)
        get_deployment_status
        ;;
    --load-test)
        export LOAD_TEST=true
        run_tests
        ;;
    --help|-h|help)
        show_help
        ;;
    *)
        log_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac
