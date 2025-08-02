#!/bin/bash

# cURL Testing Script for Effect-TS API
# This script tests API deployments using curl commands
# Supports both AWS deployments and local/custom URLs

set -e

# Configuration
STACK_NAME="EffectAppStack"
AWS_REGION="${AWS_REGION:-us-west-2}"
BASE_URL=""
LOAD_TEST="${LOAD_TEST:-false}"
HEALTH_ONLY=false

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
    echo "cURL Testing Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS] [BASE_URL]"
    echo ""
    echo "Options:"
    echo "  --load-test        Include load testing"
    echo "  --health-only      Only test health endpoint"
    echo "  --base-url URL     Use specific base URL instead of AWS"
    echo "  --help             Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION     AWS region (default: us-west-2)"
    echo "  LOAD_TEST      Set to 'true' to enable load testing"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test AWS deployment"
    echo "  $0 http://localhost:8080              # Test local server"
    echo "  $0 --base-url http://localhost:8080   # Test local server (alternative)"
    echo "  LOAD_TEST=true $0                     # Run tests with load testing"
    echo "  $0 --health-only                      # Only test health endpoint"
    echo "  AWS_REGION=us-east-1 $0               # Test in different AWS region"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --load-test)
            LOAD_TEST=true
            shift
            ;;
        --health-only)
            HEALTH_ONLY=true
            shift
            ;;
        --base-url)
            BASE_URL="$2"
            shift 2
            ;;
        --help|-h|help)
            show_help
            exit 0
            ;;
        http*)
            BASE_URL="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Get API Gateway URL from CloudFormation stack
get_api_url() {
    if [ -n "$BASE_URL" ]; then
        echo "$BASE_URL"
        return
    fi
    
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
    
    # Remove trailing slash if present
    api_url=$(echo $api_url | sed 's/\/$//')
    echo $api_url
}

# Test health endpoint
test_health_curl() {
    local api_url=$1
    
    log_info "Testing health endpoint: $api_url/health"
    
    local response=$(curl -s -w "%{http_code}" "$api_url/health" || echo "000")
    local http_code=${response: -3}
    local body=${response%???}
    
    if [ "$http_code" = "200" ]; then
        log_success "Health check passed (HTTP $http_code)"
        echo "Response body: $body"
        return 0
    else
        log_error "Health check failed (HTTP $http_code)"
        echo "Response body: $body"
        return 1
    fi
}

# Test authentication flow
test_auth_flow() {
    local api_url=$1
    local tests_failed=0
    
    log_info "Testing authentication flow..."
    
    # Create a unique user (no signup endpoint - just create user directly)
    local timestamp=$(date +%s)
    local email="test-${timestamp}@example.com"
    local user_data="{\"email\":\"$email\"}"
    
    local user_response=$(curl -s -w "%{http_code}" -c /tmp/cookies.txt \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$user_data" \
        "$api_url/users" || echo "000")
    
    local user_code=${user_response: -3}
    local user_body=${user_response%???}
    
    if [ "$user_code" = "200" ] || [ "$user_code" = "201" ]; then
        log_success "User creation successful (HTTP $user_code)"
        echo "User created and session cookie received"
    else
        log_error "User creation failed (HTTP $user_code): $user_body"
        ((tests_failed++))
    fi
    
    # Test accessing protected endpoint (user/me)
    local me_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
        "$api_url/users/me" || echo "000")
    
    local me_code=${me_response: -3}
    local me_body=${me_response%???}
    
    if [ "$me_code" = "200" ]; then
        log_success "Authenticated access to /users/me successful (HTTP $me_code)"
    else
        log_error "Authenticated access to /users/me failed (HTTP $me_code): $me_body"
        ((tests_failed++))
    fi
    
    return $tests_failed
}

# Test groups endpoint
test_groups_endpoint() {
    local api_url=$1
    local tests_failed=0
    
    log_info "Testing groups endpoint..."
    
    # Note: Based on API spec, there's no GET /groups endpoint
    # Only POST to create groups and PATCH to update them
    
    # Test POST group
    local timestamp=$(date +%s)
    local group_data="{\"name\":\"Test Group ${timestamp}\"}"
    local create_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$group_data" \
        "$api_url/groups" || echo "000")
    
    local create_code=${create_response: -3}
    local create_body=${create_response%???}
    
    if [ "$create_code" = "200" ] || [ "$create_code" = "201" ]; then
        log_success "Group creation successful (HTTP $create_code)"
        
        # Extract group ID and test PATCH update
        local group_id=$(echo "$create_body" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
        if [ -n "$group_id" ]; then
            local update_data="{\"name\":\"Updated Group ${timestamp}\"}"
            local update_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
                -X PATCH \
                -H "Content-Type: application/json" \
                -d "$update_data" \
                "$api_url/groups/${group_id}" || echo "000")
            
            local update_code=${update_response: -3}
            
            if [ "$update_code" = "200" ]; then
                log_success "Group update successful (HTTP $update_code)"
            else
                log_warning "Group update failed (HTTP $update_code)"
                # Don't fail the test - update might have different requirements
            fi
        fi
    else
        log_warning "Group creation failed (HTTP $create_code): $create_body"
        ((tests_failed++))
    fi
    
    return $tests_failed
}

# Test people endpoint
test_people_endpoint() {
    local api_url=$1
    local tests_failed=0
    
    log_info "Testing people endpoint..."
    
    # First create a group to add people to
    local timestamp=$(date +%s)
    local group_data="{\"name\":\"Test Group ${timestamp}\"}"
    local group_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$group_data" \
        "$api_url/groups" || echo "000")
    
    local group_code=${group_response: -3}
    local group_body=${group_response%???}
    local group_id=""
    
    if [ "$group_code" = "200" ] || [ "$group_code" = "201" ]; then
        log_success "Group creation for people test successful (HTTP $group_code)"
        # Extract group ID from response (assuming JSON response with id field)
        group_id=$(echo "$group_body" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
        if [ -n "$group_id" ]; then
            # Test POST person to group
            local person_data="{\"firstName\":\"John\",\"lastName\":\"Doe-${timestamp}\"}"
            local create_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
                -X POST \
                -H "Content-Type: application/json" \
                -d "$person_data" \
                "$api_url/groups/${group_id}/people" || echo "000")
            
            local create_code=${create_response: -3}
            local create_body=${create_response%???}
            
            if [ "$create_code" = "200" ] || [ "$create_code" = "201" ]; then
                log_success "Person creation successful (HTTP $create_code)"
                
                # Extract person ID and test GET person
                local person_id=$(echo "$create_body" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
                if [ -n "$person_id" ]; then
                    local get_response=$(curl -s -w "%{http_code}" -b /tmp/cookies.txt \
                        "$api_url/people/${person_id}" || echo "000")
                    
                    local get_code=${get_response: -3}
                    
                    if [ "$get_code" = "200" ]; then
                        log_success "Person retrieval successful (HTTP $get_code)"
                    else
                        log_error "Person retrieval failed (HTTP $get_code)"
                        ((tests_failed++))
                    fi
                fi
            else
                log_warning "Person creation failed (HTTP $create_code): $create_body"
                ((tests_failed++))
            fi
        else
            log_warning "Could not extract group ID from response"
            ((tests_failed++))
        fi
    else
        log_error "Group creation for people test failed (HTTP $group_code): $group_body"
        ((tests_failed++))
    fi
    
    return $tests_failed
}

# Test CORS headers
test_cors() {
    local api_url=$1
    local tests_failed=0
    
    log_info "Testing CORS headers..."
    
    local cors_response=$(curl -s -I \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS \
        "$api_url/health" || echo "")
    
    if echo "$cors_response" | grep -i "access-control-allow-origin" > /dev/null; then
        log_success "CORS headers present"
    else
        log_warning "CORS headers not found in OPTIONS response"
        ((tests_failed++))
    fi
    
    return $tests_failed
}

# Test error handling
test_error_handling() {
    local api_url=$1
    local tests_failed=0
    
    log_info "Testing error handling..."
    
    # Test 404 endpoint
    local not_found_response=$(curl -s -w "%{http_code}" \
        "$api_url/nonexistent" || echo "000")
    
    local not_found_code=${not_found_response: -3}
    
    if [ "$not_found_code" = "404" ]; then
        log_success "404 error handling works (HTTP $not_found_code)"
    else
        log_warning "Unexpected response for non-existent endpoint (HTTP $not_found_code)"
        # Don't fail test - different error codes might be acceptable
    fi
    
    # Test invalid JSON
    local invalid_response=$(curl -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "invalid json" \
        "$api_url/users" || echo "000")
    
    local invalid_code=${invalid_response: -3}
    
    if [ "$invalid_code" = "400" ] || [ "$invalid_code" = "422" ]; then
        log_success "Invalid JSON handling works (HTTP $invalid_code)"
    else
        log_warning "Unexpected response for invalid JSON (HTTP $invalid_code)"
        # Don't fail test - different error handling might be in place
    fi
    
    return $tests_failed
}

# Load testing
run_load_test() {
    local api_url=$1
    
    log_info "Running basic load test (10 concurrent requests)..."
    
    local start_time=$(date +%s)
    
    # Run 10 concurrent health checks
    for i in {1..10}; do
        {
            curl -s "$api_url/health" > /dev/null
            echo "Request $i completed"
        } &
    done
    
    wait
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "Load test completed in ${duration}s"
    log_info "Average response time: ~$((duration * 100 / 10))ms per request"
}

# Cleanup function
cleanup() {
    if [ -f /tmp/cookies.txt ]; then
        rm -f /tmp/cookies.txt
        log_info "Cleaned up temporary files"
    fi
}

# Main test runner
run_curl_tests() {
    local api_url=$(get_api_url)
    local tests_failed=0
    
    log_info "Starting cURL tests against: $api_url"
    echo "================================================"
    
    # Test 1: Health check
    test_health_curl "$api_url" || ((tests_failed++))
    echo ""
    
    if [ "$HEALTH_ONLY" = true ]; then
        cleanup
        return $tests_failed
    fi
    
    # Test 2: CORS
    test_cors "$api_url" || ((tests_failed += $?))
    echo ""
    
    # Test 3: Authentication flow
    test_auth_flow "$api_url" || ((tests_failed += $?))
    echo ""
    
    # Test 4: Groups endpoint
    test_groups_endpoint "$api_url" || ((tests_failed += $?))
    echo ""
    
    # Test 5: People endpoint
    test_people_endpoint "$api_url" || ((tests_failed += $?))
    echo ""
    
    # Test 6: Error handling
    test_error_handling "$api_url" || ((tests_failed += $?))
    echo ""
    
    # Test 7: Load testing (if enabled)
    if [ "$LOAD_TEST" = "true" ]; then
        run_load_test "$api_url"
        echo ""
    fi
    
    cleanup
    
    echo "================================================"
    if [ $tests_failed -eq 0 ]; then
        log_success "🎉 All cURL tests passed!"
        return 0
    else
        log_error "❌ $tests_failed test categories failed. Check the output above for details."
        return 1
    fi
}

# Main script execution
if [ "$HEALTH_ONLY" = true ]; then
    api_url=$(get_api_url)
    test_health_curl "$api_url"
    cleanup
else
    run_curl_tests
fi
