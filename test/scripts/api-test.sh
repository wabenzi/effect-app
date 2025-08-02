#!/bin/bash

# API Testing Script for Effect-TS API
# Comprehensive API endpoint testing with curl
# Consolidates functionality from test-curl.sh and test-aws-curl.sh

set -e

# Configuration
STACK_NAME="EffectAppStack-v2"
AWS_REGION="${AWS_REGION:-us-west-2}"
BASE_URL=""
LOAD_TEST=false
HEALTH_ONLY=false
VERBOSE=false

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

log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[VERBOSE]${NC} $1"
    fi
}

# Show help
show_help() {
    echo "API Testing Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS] [BASE_URL]"
    echo ""
    echo "Options:"
    echo "  --load-test        Include load testing (multiple concurrent requests)"
    echo "  --health-only      Only test health endpoint"
    echo "  --base-url URL     Use specific base URL instead of AWS CloudFormation"
    echo "  --stack-name NAME  CloudFormation stack name (default: $STACK_NAME)"
    echo "  --region REGION    AWS region (default: $AWS_REGION)"
    echo "  --verbose          Enable verbose logging"
    echo "  --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test AWS deployment"
    echo "  $0 --health-only                     # Quick health check only"
    echo "  $0 --load-test                       # Include performance testing"
    echo "  $0 --base-url http://localhost:3000  # Test local server"
    echo "  $0 https://api.example.com           # Test custom URL"
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
        log_error "Make sure the stack is deployed or use --base-url option"
        exit 1
    fi
    
    BASE_URL="$api_url"
    log_success "API Gateway URL: $BASE_URL"
}

# Test health endpoint
test_health() {
    log_info "Testing health endpoint..."
    
    local health_url="$BASE_URL/health"
    local response
    local http_code
    local time_total
    local body
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code};TIME:%{time_total}" "$health_url" || echo "HTTPSTATUS:000;TIME:0")
    http_code=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://' | sed -e 's/;TIME.*//')
    time_total=$(echo "$response" | tr -d '\n' | sed -e 's/.*TIME://')
    body=$(echo "$response" | sed -E 's/HTTPSTATUS:[0-9]{3};TIME:[0-9\.]+//')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Health endpoint: HTTP $http_code (${time_total}s)"
        log_verbose "Response: $body"
        return 0
    else
        log_error "Health endpoint failed: HTTP $http_code"
        if [ -n "$body" ]; then
            log_error "Response: $body"
        fi
        return 1
    fi
}

# Test user creation (placeholder for future API endpoints)
test_user_creation() {
    log_info "Testing user creation endpoint..."
    
    local create_url="$BASE_URL/users"
    local test_email="test-$(date +%s)@example.com"
    local cookie_jar=$(mktemp)
    
    # Note: This is a placeholder for when user endpoints are implemented
    local response
    local http_code
    
    response=$(curl -s -w "%{http_code}" -c "$cookie_jar" \
        -H "Content-Type: application/json" \
        -X POST \
        -d "{\"email\":\"$test_email\"}" \
        "$create_url" || echo "000")
    
    rm -f "$cookie_jar"
    
    if [ "$response" = "404" ]; then
        log_warning "User creation endpoint not implemented yet (HTTP 404)"
        return 0
    elif [ "$response" = "200" ] || [ "$response" = "201" ]; then
        log_success "User creation: HTTP $response"
        return 0
    else
        log_warning "User creation endpoint: HTTP $response"
        return 0
    fi
}

# Load testing with concurrent requests
run_load_test() {
    log_info "Running load test (10 concurrent health checks)..."
    
    local health_url="$BASE_URL/health"
    local temp_dir=$(mktemp -d)
    local pids=()
    local success_count=0
    local total_time=0
    
    # Start timer
    local start_time=$(date +%s.%N)
    
    # Launch concurrent requests
    for i in {1..10}; do
        (
            response=$(curl -s -w "%{time_total}" -o /dev/null "$health_url" 2>/dev/null || echo "999")
            echo "$response" > "$temp_dir/result_$i"
        ) &
        pids+=($!)
    done
    
    # Wait for all requests to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done
    
    local end_time=$(date +%s.%N)
    local total_duration=$(echo "$end_time - $start_time" | bc -l 2>/dev/null || echo "0")
    
    # Analyze results
    for i in {1..10}; do
        if [ -f "$temp_dir/result_$i" ]; then
            local result=$(cat "$temp_dir/result_$i")
            if [[ "$result" =~ ^[0-9]*\.?[0-9]+$ ]]; then
                success_count=$((success_count + 1))
                total_time=$(echo "$total_time + $result" | bc -l 2>/dev/null || echo "$total_time")
            fi
        fi
    done
    
    # Clean up
    rm -rf "$temp_dir"
    
    if [ "$success_count" -gt 0 ]; then
        local avg_time=$(echo "scale=3; $total_time / $success_count" | bc -l 2>/dev/null || echo "0")
        log_success "Load test completed: $success_count/10 requests successful"
        log_info "Average response time: ${avg_time}s"
        log_info "Total test duration: ${total_duration}s"
    else
        log_error "Load test failed: no successful requests"
        return 1
    fi
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
        --stack-name)
            STACK_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
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
            if [ -z "$BASE_URL" ]; then
                BASE_URL="$1"
            fi
            shift
            ;;
    esac
done

# Main execution
echo "🚀 API Testing for Effect-TS API"
echo "================================="

if [ -z "$BASE_URL" ]; then
    get_api_url
else
    log_info "Using provided URL: $BASE_URL"
fi

# Remove trailing slash
BASE_URL="${BASE_URL%/}"

# Run tests
log_info "Starting API tests..."

if ! test_health; then
    log_error "Health check failed, stopping tests"
    exit 1
fi

if [ "$HEALTH_ONLY" = false ]; then
    test_user_creation
    
    if [ "$LOAD_TEST" = true ]; then
        if command -v bc >/dev/null 2>&1; then
            run_load_test
        else
            log_warning "Load test skipped: 'bc' calculator not available"
        fi
    fi
fi

log_success "API testing completed successfully!"
