#!/bin/bash

# Combined Integration Test Script
# Tests both local development server and AWS deployed API

set -e

# Configuration
STACK_NAME="EffectAppStack"
AWS_REGION="${AWS_REGION:-us-west-2}"
LOCAL_URL="http://localhost:3000"

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
    if curl -s "$LOCAL_URL/health" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Check if AWS deployment is available
check_aws_deployment() {
    local aws_url=$(get_aws_api_url)
    if [ -n "$aws_url" ] && [ "$aws_url" != "None" ]; then
        if curl -s "$aws_url/health" > /dev/null 2>&1; then
            echo "$aws_url"
            return 0
        fi
    fi
    return 1
}

# Run local integration tests
run_local_tests() {
    log_info "Running local integration tests..."
    
    if ! check_local_server; then
        log_error "Local server is not running at $LOCAL_URL"
        log_info "Start the server with: npm run dev"
        return 1
    fi
    
    log_success "Local server is running"
    
    # Run the existing local integration tests
    npm run test:integration-only
    
    if [ $? -eq 0 ]; then
        log_success "Local integration tests passed"
        return 0
    else
        log_error "Local integration tests failed"
        return 1
    fi
}

# Run AWS integration tests
run_aws_tests() {
    log_info "Running AWS integration tests..."
    
    local aws_url=$(check_aws_deployment)
    if [ $? -ne 0 ]; then
        log_error "AWS deployment is not available or not responding"
        log_info "Deploy with: npm run aws:deploy"
        return 1
    fi
    
    log_success "AWS deployment is available at: $aws_url"
    
    # Set environment variable for the test
    export AWS_API_URL="$aws_url"
    
    # Run AWS-specific integration tests
    npx vitest run test/integration/aws-api.test.ts
    
    if [ $? -eq 0 ]; then
        log_success "AWS integration tests passed"
        return 0
    else
        log_error "AWS integration tests failed"
        return 1
    fi
}

# Run curl tests against AWS
run_aws_curl_tests() {
    log_info "Running cURL tests against AWS..."
    
    ./test-aws-curl.sh
    
    if [ $? -eq 0 ]; then
        log_success "AWS cURL tests passed"
        return 0
    else
        log_error "AWS cURL tests failed"
        return 1
    fi
}

# Compare local vs AWS responses
compare_environments() {
    log_info "Comparing local vs AWS API responses..."
    
    local aws_url=$(get_aws_api_url)
    if [ -z "$aws_url" ] || [ "$aws_url" == "None" ]; then
        log_warning "AWS deployment not available, skipping comparison"
        return 0
    fi
    
    if ! check_local_server; then
        log_warning "Local server not available, skipping comparison"
        return 0
    fi
    
    echo -e "\n${GREEN}=== Environment Comparison ===${NC}"
    
    # Compare health endpoints
    echo -e "\n${BLUE}Health Endpoint Comparison:${NC}"
    echo "Local Response:"
    curl -s "$LOCAL_URL/health" | jq . 2>/dev/null || curl -s "$LOCAL_URL/health"
    
    echo -e "\nAWS Response:"
    curl -s "$aws_url/health" | jq . 2>/dev/null || curl -s "$aws_url/health"
    
    # Compare response times
    echo -e "\n${BLUE}Response Time Comparison:${NC}"
    
    local local_time=$(curl -s -w "%{time_total}" "$LOCAL_URL/health" -o /dev/null)
    local aws_time=$(curl -s -w "%{time_total}" "$aws_url/health" -o /dev/null)
    
    echo "Local response time: ${local_time}s"
    echo "AWS response time: ${aws_time}s"
    
    # Create a test user on both environments for comparison
    echo -e "\n${BLUE}User Creation Comparison:${NC}"
    local timestamp=$(date +%s)
    local email="comparison-test-${timestamp}@example.com"
    local payload="{\"email\":\"$email\"}"
    
    echo "Creating user on local environment..."
    local local_user_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$LOCAL_URL/users")
    echo "Local user creation response:"
    echo "$local_user_response" | jq . 2>/dev/null || echo "$local_user_response"
    
    echo -e "\nCreating user on AWS environment..."
    local aws_user_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$aws_url/users")
    echo "AWS user creation response:"
    echo "$aws_user_response" | jq . 2>/dev/null || echo "$aws_user_response"
    
    log_success "Environment comparison completed"
}

# Run performance benchmarks
run_performance_tests() {
    log_info "Running performance benchmarks..."
    
    local aws_url=$(get_aws_api_url)
    
    echo -e "\n${GREEN}=== Performance Benchmarks ===${NC}"
    
    # Test local server if available
    if check_local_server; then
        echo -e "\n${BLUE}Local Server Performance:${NC}"
        if command -v ab &> /dev/null; then
            ab -n 100 -c 10 "$LOCAL_URL/health" | grep -E "(Requests per second|Time per request|Transfer rate)"
        else
            log_warning "Apache Bench (ab) not available for performance testing"
            # Simple curl-based test
            echo "Running simple performance test..."
            local start_time=$(date +%s)
            for i in {1..10}; do
                curl -s "$LOCAL_URL/health" > /dev/null
            done
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            echo "10 requests completed in ${duration}s ($(echo "scale=2; 10/$duration" | bc -l 2>/dev/null || echo "N/A") req/s)"
        fi
    fi
    
    # Test AWS deployment if available
    if [ -n "$aws_url" ] && [ "$aws_url" != "None" ]; then
        echo -e "\n${BLUE}AWS Deployment Performance:${NC}"
        if command -v ab &> /dev/null; then
            ab -n 100 -c 10 "$aws_url/health" | grep -E "(Requests per second|Time per request|Transfer rate)"
        else
            # Simple curl-based test
            echo "Running simple performance test..."
            local start_time=$(date +%s)
            for i in {1..10}; do
                curl -s "$aws_url/health" > /dev/null
            done
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            echo "10 requests completed in ${duration}s ($(echo "scale=2; 10/$duration" | bc -l 2>/dev/null || echo "N/A") req/s)"
        fi
    fi
    
    log_success "Performance benchmarks completed"
}

# Show detailed help
show_help() {
    echo "Combined Integration Test Script for Effect-TS Application"
    echo ""
    echo "This script can test both local development server and AWS deployed API"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  local        Run local integration tests only"
    echo "  aws          Run AWS integration tests only"
    echo "  aws-curl     Run cURL tests against AWS only"
    echo "  compare      Compare local vs AWS responses"
    echo "  performance  Run performance benchmarks"
    echo "  all          Run all available tests (default)"
    echo "  help         Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION   AWS region (default: us-west-2)"
    echo "  AWS_API_URL  Override AWS API URL (auto-detected from CloudFormation)"
    echo ""
    echo "Prerequisites:"
    echo "  Local tests:   Local server running at http://localhost:3000"
    echo "  AWS tests:     AWS stack deployed and responding"
    echo ""
    echo "Examples:"
    echo "  $0 all                         # Run all available tests"
    echo "  $0 local                       # Test local server only"
    echo "  $0 aws                         # Test AWS deployment only"
    echo "  $0 aws-curl                    # cURL tests against AWS"
    echo "  $0 compare                     # Compare environments"
    echo "  AWS_REGION=us-east-1 $0 aws    # Test AWS in different region"
}

# Main function to run all tests
run_all_tests() {
    echo -e "${GREEN}🚀 Running Complete Integration Test Suite${NC}\n"
    
    local local_available=false
    local aws_available=false
    local tests_run=0
    local tests_passed=0
    
    # Check availability
    if check_local_server; then
        local_available=true
        log_success "Local server detected at $LOCAL_URL"
    else
        log_warning "Local server not available at $LOCAL_URL"
    fi
    
    local aws_url=$(check_aws_deployment)
    if [ $? -eq 0 ]; then
        aws_available=true
        log_success "AWS deployment detected at $aws_url"
    else
        log_warning "AWS deployment not available"
    fi
    
    if [ "$local_available" = false ] && [ "$aws_available" = false ]; then
        log_error "Neither local server nor AWS deployment is available"
        log_info "Start local server with: npm run dev"
        log_info "Deploy to AWS with: npm run aws:deploy"
        exit 1
    fi
    
    echo -e "\n${GREEN}=== Running Available Tests ===${NC}"
    
    # Run local tests if available
    if [ "$local_available" = true ]; then
        tests_run=$((tests_run + 1))
        if run_local_tests; then
            tests_passed=$((tests_passed + 1))
        fi
    fi
    
    # Run AWS tests if available
    if [ "$aws_available" = true ]; then
        echo ""
        tests_run=$((tests_run + 1))
        if run_aws_tests; then
            tests_passed=$((tests_passed + 1))
        fi
        
        echo ""
        tests_run=$((tests_run + 1))
        if run_aws_curl_tests; then
            tests_passed=$((tests_passed + 1))
        fi
    fi
    
    # Run comparison if both are available
    if [ "$local_available" = true ] && [ "$aws_available" = true ]; then
        echo ""
        compare_environments
        echo ""
        run_performance_tests
    fi
    
    # Summary
    echo -e "\n${GREEN}=== Test Summary ===${NC}"
    echo -e "${GREEN}Tests Passed: $tests_passed/$tests_run${NC}"
    
    if [ $tests_passed -eq $tests_run ]; then
        log_success "🎉 All available tests passed!"
        exit 0
    else
        log_error "❌ Some tests failed"
        exit 1
    fi
}

# Main script logic
case "${1:-all}" in
    local)
        run_local_tests
        ;;
    aws)
        run_aws_tests
        ;;
    aws-curl)
        run_aws_curl_tests
        ;;
    compare)
        compare_environments
        ;;
    performance)
        run_performance_tests
        ;;
    all)
        run_all_tests
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
