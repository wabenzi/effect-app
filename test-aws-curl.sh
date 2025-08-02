#!/bin/bash

# cURL Testing Script for AWS Deployed Effect-TS API
# This script tests the deployed API using curl commands

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
    
    local api_url=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null)
    
    if [ -z "$api_url" ] || [ "$api_url" == "None" ]; then
        log_error "Could not retrieve API Gateway URL from stack $STACK_NAME"
        log_error "Make sure the stack is deployed: ./deploy.sh"
        exit 1
    fi
    
    log_success "API Gateway URL: $api_url"
    echo "$api_url"
}

# Test 1: Health Check
test_health_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 1: Health Check ===${NC}"
    log_info "Testing health endpoint with curl..."
    
    echo "Command: curl -v \"$api_url/health\""
    echo "Response:"
    
    local response=$(curl -s -w "\nHTTP_CODE:%{http_code}\nTIME_TOTAL:%{time_total}\n" \
        "$api_url/health")
    
    echo "$response"
    
    local http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    local time_total=$(echo "$response" | grep "TIME_TOTAL:" | cut -d: -f2)
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Health check passed (${time_total}s)"
        return 0
    else
        log_error "Health check failed with status $http_code"
        return 1
    fi
}

# Test 2: User Creation
test_user_creation_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 2: User Creation ===${NC}"
    log_info "Testing user creation with curl..."
    
    local timestamp=$(date +%s)
    local email="curl-test-${timestamp}@example.com"
    local payload="{\"email\":\"$email\"}"
    
    echo "Command: curl -X POST -H \"Content-Type: application/json\" -d '$payload' \"$api_url/users\""
    echo "Response:"
    
    # Use curl with verbose headers to capture Set-Cookie
    local response=$(curl -s -v -w "\nHTTP_CODE:%{http_code}\n" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$api_url/users" 2>&1)
    
    echo "$response"
    
    local http_code=$(echo "$response" | grep "HTTP_CODE:" | tail -1 | cut -d: -f2)
    
    if [ "$http_code" -eq 200 ]; then
        log_success "User creation passed"
        
        # Extract session cookie from headers
        local set_cookie=$(echo "$response" | grep -i "set-cookie:" | grep "token=" | head -1)
        if [ -n "$set_cookie" ]; then
            local session_token=$(echo "$set_cookie" | sed 's/.*token=\([^;]*\).*/\1/')
            echo "SESSION_TOKEN=$session_token" > .curl_session
            log_success "Session token extracted: $session_token"
        else
            log_warning "Could not extract session token from response"
        fi
        
        return 0
    else
        log_error "User creation failed with status $http_code"
        return 1
    fi
}

# Test 3: Authenticated Group Creation
test_group_creation_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 3: Authenticated Group Creation ===${NC}"
    log_info "Testing authenticated group creation with curl..."
    
    if [ ! -f ".curl_session" ]; then
        log_error "No session token found. Run user creation test first."
        return 1
    fi
    
    local session_token=$(cat .curl_session | cut -d'=' -f2)
    local timestamp=$(date +%s)
    local group_name="cURL Test Group $timestamp"
    local payload="{\"name\":\"$group_name\"}"
    
    echo "Command: curl -X POST -H \"Content-Type: application/json\" -H \"Cookie: token=$session_token\" -d '$payload' \"$api_url/groups\""
    echo "Response:"
    
    local response=$(curl -s -w "\nHTTP_CODE:%{http_code}\n" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Cookie: token=$session_token" \
        -d "$payload" \
        "$api_url/groups")
    
    echo "$response"
    
    local http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Group creation passed"
        return 0
    else
        log_error "Group creation failed with status $http_code"
        return 1
    fi
}

# Test 4: Unauthenticated Request
test_unauthenticated_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 4: Unauthenticated Request ===${NC}"
    log_info "Testing unauthenticated request rejection with curl..."
    
    echo "Command: curl -X GET \"$api_url/users/me\""
    echo "Response:"
    
    local response=$(curl -s -w "\nHTTP_CODE:%{http_code}\n" \
        -X GET \
        "$api_url/users/me")
    
    echo "$response"
    
    local http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d: -f2)
    
    if [ "$http_code" -eq 403 ]; then
        log_success "Unauthenticated request properly rejected"
        return 0
    else
        log_error "Expected 403 for unauthenticated request, got $http_code"
        return 1
    fi
}

# Test 5: CORS Preflight
test_cors_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 5: CORS Preflight ===${NC}"
    log_info "Testing CORS preflight request with curl..."
    
    echo "Command: curl -X OPTIONS -H \"Origin: https://example.com\" -H \"Access-Control-Request-Method: POST\" \"$api_url/users\""
    echo "Response:"
    
    local response=$(curl -s -v -w "\nHTTP_CODE:%{http_code}\n" \
        -X OPTIONS \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        "$api_url/users" 2>&1)
    
    echo "$response"
    
    local http_code=$(echo "$response" | grep "HTTP_CODE:" | tail -1 | cut -d: -f2)
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 204 ]; then
        # Check for CORS headers
        if echo "$response" | grep -i "access-control-allow-origin" > /dev/null; then
            log_success "CORS preflight passed"
            return 0
        else
            log_warning "CORS preflight response received but CORS headers not found"
            return 1
        fi
    else
        log_error "CORS preflight failed with status $http_code"
        return 1
    fi
}

# Test 6: Load Test with curl
test_load_curl() {
    local api_url=$1
    local requests=${2:-50}
    local concurrency=${3:-5}
    
    echo -e "\n${GREEN}=== Test 6: Load Test ===${NC}"
    log_info "Running load test with $requests requests, $concurrency concurrent..."
    
    if ! command -v xargs &> /dev/null; then
        log_warning "xargs not available, skipping load test"
        return 0
    fi
    
    # Create a temporary script for parallel requests
    cat > /tmp/curl_load_test.sh << 'EOF'
#!/bin/bash
api_url=$1
request_id=$2
start_time=$(date +%s.%N)
response=$(curl -s -w "HTTP_CODE:%{http_code};TIME:%{time_total}" "$api_url/health" 2>/dev/null)
end_time=$(date +%s.%N)
duration=$(echo "$end_time - $start_time" | bc -l 2>/dev/null || echo "0")
http_code=$(echo "$response" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
time_total=$(echo "$response" | grep -o "TIME:[0-9.]*" | cut -d: -f2)
echo "Request $request_id: HTTP $http_code in ${time_total}s"
EOF
    
    chmod +x /tmp/curl_load_test.sh
    
    echo "Running $requests requests with $concurrency concurrent connections..."
    seq 1 $requests | xargs -n1 -P$concurrency -I{} /tmp/curl_load_test.sh "$api_url" {}
    
    rm -f /tmp/curl_load_test.sh
    log_success "Load test completed"
}

# Test 7: API Documentation
test_api_docs_curl() {
    local api_url=$1
    
    echo -e "\n${GREEN}=== Test 7: API Documentation ===${NC}"
    log_info "Testing API documentation endpoint..."
    
    # Try common documentation paths
    local doc_paths=("/docs" "/swagger" "/openapi" "/api-docs")
    
    for path in "${doc_paths[@]}"; do
        echo "Testing: curl \"$api_url$path\""
        local response=$(curl -s -w "HTTP_CODE:%{http_code}" "$api_url$path")
        local http_code=$(echo "$response" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
        
        if [ "$http_code" -eq 200 ]; then
            log_success "API documentation found at: $api_url$path"
            return 0
        fi
    done
    
    log_warning "API documentation endpoint not found"
    return 0  # Not critical
}

# Cleanup function
cleanup() {
    rm -f .curl_session
}

# Main test function
run_curl_tests() {
    echo -e "${GREEN}🚀 Starting cURL Tests for AWS Deployed Effect-TS API${NC}\n"
    
    local api_url=$(get_api_url)
    local tests_passed=0
    local tests_failed=0
    
    # Run all tests
    echo -e "${BLUE}Running comprehensive cURL test suite...${NC}"
    
    # Test 1: Health Check
    if test_health_curl "$api_url"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test 2: User Creation
    if test_user_creation_curl "$api_url"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test 3: Group Creation (depends on Test 2)
    if [ $tests_failed -eq 0 ] && test_group_creation_curl "$api_url"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test 4: Unauthenticated Request
    if test_unauthenticated_curl "$api_url"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test 5: CORS Preflight
    if test_cors_curl "$api_url"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    # Test 6: Load Test (optional)
    if [ "${LOAD_TEST:-false}" = "true" ]; then
        test_load_curl "$api_url" 20 3
    fi
    
    # Test 7: API Documentation
    test_api_docs_curl "$api_url"
    
    cleanup
    
    # Summary
    echo -e "\n${GREEN}=== Test Summary ===${NC}"
    echo -e "${GREEN}Tests Passed: $tests_passed${NC}"
    echo -e "${RED}Tests Failed: $tests_failed${NC}"
    echo -e "${BLUE}API Gateway URL: $api_url${NC}"
    
    if [ $tests_failed -eq 0 ]; then
        log_success "🎉 All cURL tests passed!"
        return 0
    else
        log_error "❌ Some tests failed. Check the output above for details."
        return 1
    fi
}

# Show help
show_help() {
    echo "cURL Testing Script for AWS Deployed Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --load-test    Include load testing"
    echo "  --health-only  Only test health endpoint"
    echo "  --help         Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION     AWS region (default: us-west-2)"
    echo "  LOAD_TEST      Set to 'true' to enable load testing"
    echo ""
    echo "Examples:"
    echo "  $0                           # Run all tests"
    echo "  LOAD_TEST=true $0            # Run tests with load testing"
    echo "  $0 --health-only             # Only test health endpoint"
    echo "  AWS_REGION=us-east-1 $0      # Test in different region"
}

# Main script logic
case "${1:-test}" in
    test|"")
        run_curl_tests
        ;;
    --health-only)
        api_url=$(get_api_url)
        test_health_curl "$api_url"
        cleanup
        ;;
    --load-test)
        export LOAD_TEST=true
        run_curl_tests
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
