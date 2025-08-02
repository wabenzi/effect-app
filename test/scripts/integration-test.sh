#!/bin/bash

# Integration Testing Script for Effect-TS API
# Tests both local development server and AWS deployed API
# Based on test-integration-complete.sh with improvements

set -e

# Configuration
STACK_NAME="EffectAppStack-v2"
AWS_REGION="${AWS_REGION:-us-west-2}"
LOCAL_URL="http://localhost:3000"
TEST_LOCAL=true
TEST_AWS=true
COMPARE_ONLY=false

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
    echo "Integration Testing Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --local-only         Test only local development server"
    echo "  --aws-only           Test only AWS deployed API"
    echo "  --compare-only       Only compare responses (skip individual tests)"
    echo "  --local-url URL      Local server URL (default: $LOCAL_URL)"
    echo "  --stack-name NAME    CloudFormation stack name (default: $STACK_NAME)"
    echo "  --region REGION      AWS region (default: $AWS_REGION)"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                           # Test both local and AWS"
    echo "  $0 --local-only              # Test only local server"
    echo "  $0 --aws-only                # Test only AWS deployment"
    echo "  $0 --compare-only            # Only compare local vs AWS responses"
    echo "  $0 --local-url http://localhost:8080  # Custom local URL"
}

# Get AWS API URL
get_aws_api_url() {
    aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null || echo ""
}

# Check if local server is running
check_local_server() {
    if curl -s "$LOCAL_URL/health" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Test health endpoint
test_health_endpoint() {
    local url="$1"
    local name="$2"
    
    log_info "Testing $name health endpoint: $url/health"
    
    local response
    local http_code
    local time_total
    local body
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code};TIME:%{time_total}" "$url/health" --max-time 30 || echo "HTTPSTATUS:000;TIME:0")
    http_code=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://' | sed -e 's/;TIME.*//')
    time_total=$(echo "$response" | tr -d '\n' | sed -e 's/.*TIME://')
    body=$(echo "$response" | sed -E 's/HTTPSTATUS:[0-9]{3};TIME:[0-9\.]+//')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "$name: HTTP $http_code (${time_total}s)"
        
        # Validate JSON response if jq is available
        if command -v jq >/dev/null 2>&1; then
            local status
            status=$(echo "$body" | jq -r '.status' 2>/dev/null || echo "unknown")
            
            if [ "$status" = "healthy" ]; then
                log_success "$name status: $status"
            else
                log_warning "$name unexpected status: $status"
            fi
        fi
        
        return 0
    else
        log_error "$name: HTTP $http_code"
        if [ -n "$body" ]; then
            log_error "$name response: $body"
        fi
        return 1
    fi
}

# Test basic API functionality
test_basic_api() {
    local url="$1"
    local name="$2"
    
    log_info "Testing $name basic API functionality..."
    
    # Test 404 for non-existent endpoint
    local not_found_code
    not_found_code=$(curl -s -w "%{http_code}" -o /dev/null "$url/nonexistent" --max-time 10 || echo "000")
    
    if [ "$not_found_code" = "404" ]; then
        log_success "$name: Correctly returns 404 for unknown endpoints"
    else
        log_warning "$name: Expected 404 for unknown endpoints, got $not_found_code"
    fi
    
    # Test CORS headers (if applicable)
    local cors_header
    cors_header=$(curl -s -I "$url/health" --max-time 10 | grep -i "access-control-allow-origin" || echo "")
    
    if [ -n "$cors_header" ]; then
        log_success "$name: CORS headers present"
    else
        log_info "$name: No CORS headers (may be expected)"
    fi
}

# Test local server
test_local() {
    log_info "=== Testing Local Development Server ==="
    
    if check_local_server; then
        log_success "Local server is running at $LOCAL_URL"
        
        if test_health_endpoint "$LOCAL_URL" "Local"; then
            test_basic_api "$LOCAL_URL" "Local"
            return 0
        else
            return 1
        fi
    else
        log_warning "Local server is not running at $LOCAL_URL"
        log_info "To start local server: npm run dev (or equivalent)"
        return 1
    fi
}

# Test AWS deployment
test_aws() {
    log_info "=== Testing AWS Deployment ==="
    
    local aws_url
    aws_url=$(get_aws_api_url)
    
    if [ -z "$aws_url" ] || [ "$aws_url" = "None" ]; then
        log_warning "AWS API Gateway URL not found"
        log_info "Make sure the stack is deployed: cdk deploy"
        return 1
    fi
    
    log_success "AWS API Gateway URL: $aws_url"
    
    if test_health_endpoint "$aws_url" "AWS"; then
        test_basic_api "$aws_url" "AWS"
        return 0
    else
        return 1
    fi
}

# Compare local vs AWS
compare_responses() {
    if [ "$TEST_LOCAL" = true ] && [ "$TEST_AWS" = true ]; then
        log_info "=== Comparing Local vs AWS Responses ==="
        
        if ! check_local_server; then
            log_warning "Cannot compare: local server not running"
            return 0
        fi
        
        local aws_url
        aws_url=$(get_aws_api_url)
        
        if [ -z "$aws_url" ] || [ "$aws_url" = "None" ]; then
            log_warning "Cannot compare: AWS URL not available"
            return 0
        fi
        
        log_info "Comparing health endpoint responses..."
        
        local local_response
        local aws_response
        
        local_response=$(curl -s "$LOCAL_URL/health" --max-time 10 2>/dev/null || echo "{}")
        aws_response=$(curl -s "$aws_url/health" --max-time 10 2>/dev/null || echo "{}")
        
        if command -v jq >/dev/null 2>&1; then
            local local_status
            local aws_status
            
            local_status=$(echo "$local_response" | jq -r '.status' 2>/dev/null || echo "unknown")
            aws_status=$(echo "$aws_response" | jq -r '.status' 2>/dev/null || echo "unknown")
            
            if [ "$local_status" = "$aws_status" ] && [ "$local_status" = "healthy" ]; then
                log_success "Both local and AWS return consistent healthy status"
            else
                log_warning "Status mismatch - Local: $local_status, AWS: $aws_status"
            fi
        else
            if [ "$local_response" = "$aws_response" ]; then
                log_success "Local and AWS responses are identical"
            else
                log_info "Response format comparison skipped (jq not available)"
            fi
        fi
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --local-only)
            TEST_LOCAL=true
            TEST_AWS=false
            shift
            ;;
        --aws-only)
            TEST_LOCAL=false
            TEST_AWS=true
            shift
            ;;
        --compare-only)
            COMPARE_ONLY=true
            shift
            ;;
        --local-url)
            LOCAL_URL="$2"
            shift 2
            ;;
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
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
echo "🚀 Integration Testing for Effect-TS API"
echo "========================================"
echo "Local URL: $LOCAL_URL"
echo "Stack: $STACK_NAME"
echo "Region: $AWS_REGION"
echo "Test local: $TEST_LOCAL"
echo "Test AWS: $TEST_AWS"
echo "Compare only: $COMPARE_ONLY"
echo ""

local_success=true
aws_success=true

if [ "$COMPARE_ONLY" = true ]; then
    # Skip individual tests, just do comparison
    compare_responses
    log_success "Comparison completed"
    exit 0
fi

if [ "$TEST_LOCAL" = true ]; then
    if ! test_local; then
        local_success=false
    fi
    echo ""
fi

if [ "$TEST_AWS" = true ]; then
    if ! test_aws; then
        aws_success=false
    fi
    echo ""
fi

compare_responses

# Summary
echo "=== Test Summary ==="
if [ "$TEST_LOCAL" = true ]; then
    if [ "$local_success" = true ]; then
        log_success "Local server tests: PASSED"
    else
        log_error "Local server tests: FAILED"
    fi
fi

if [ "$TEST_AWS" = true ]; then
    if [ "$aws_success" = true ]; then
        log_success "AWS deployment tests: PASSED"
    else
        log_error "AWS deployment tests: FAILED"
    fi
fi

if ( [ "$TEST_LOCAL" = false ] || [ "$local_success" = true ] ) && \
   ( [ "$TEST_AWS" = false ] || [ "$aws_success" = true ] ); then
    log_success "Integration testing completed successfully!"
    exit 0
else
    log_error "Some tests failed"
    exit 1
fi
