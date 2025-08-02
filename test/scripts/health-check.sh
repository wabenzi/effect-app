#!/bin/bash

# Health Check Script for Effect-TS API
# Tests health endpoint with comprehensive validation
# Combines functionality from test-aws-comprehensive.sh and test-deployment-working.sh

set -e

# Configuration
STACK_NAME="EffectAppStack-v2"
AWS_REGION="${AWS_REGION:-us-west-2}"
API_URL_OVERRIDE=""

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
    echo "Health Check Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS] [URL]"
    echo ""
    echo "Options:"
    echo "  --url URL          Use specific URL instead of AWS CloudFormation"
    echo "  --stack-name NAME  CloudFormation stack name (default: $STACK_NAME)"
    echo "  --region REGION    AWS region (default: $AWS_REGION)"
    echo "  --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test AWS deployment"
    echo "  $0 --url http://localhost:3000       # Test local server"
    echo "  $0 --url https://api.example.com     # Test custom URL"
}

# Get API Gateway URL from CloudFormation stack
get_api_url() {
    log_info "Retrieving API Gateway URL from CloudFormation..."
    
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null)
    
    if [ -z "$API_URL" ] || [ "$API_URL" == "None" ]; then
        log_error "Could not retrieve API Gateway URL from stack $STACK_NAME"
        log_error "Make sure the stack is deployed or use --url option"
        exit 1
    fi
    
    log_success "API Gateway URL: $API_URL"
}

# Validate TLS/HTTPS
validate_tls() {
    if [[ "$API_URL" == https://* ]]; then
        log_info "Validating TLS/HTTPS security..."
        tls_info=$(curl -s -I "$API_URL/health" | grep -E "(HTTP|Server|Date)" || true)
        if [ -n "$tls_info" ]; then
            log_success "TLS connection established"
        else
            log_warning "Could not validate TLS connection"
        fi
    fi
}

# Test health endpoint
test_health() {
    local health_endpoint="$API_URL/health"
    
    log_info "Testing health endpoint: $health_endpoint"
    
    # Get response with timing and status
    response=$(curl -s -w "HTTPSTATUS:%{http_code};TIME:%{time_total}" "$health_endpoint" || echo "HTTPSTATUS:000;TIME:0")
    http_code=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://' | sed -e 's/;TIME.*//')
    time_total=$(echo "$response" | tr -d '\n' | sed -e 's/.*TIME://')
    body=$(echo "$response" | sed -E 's/HTTPSTATUS:[0-9]{3};TIME:[0-9\.]+//')
    
    if [ "$http_code" -eq 200 ]; then
        log_success "Health check passed (HTTP $http_code)"
        log_info "Response time: ${time_total}s"
        
        # Validate JSON response
        if command -v jq >/dev/null 2>&1; then
            status=$(echo "$body" | jq -r '.status' 2>/dev/null || echo "unknown")
            timestamp=$(echo "$body" | jq -r '.timestamp' 2>/dev/null || echo "unknown")
            uptime=$(echo "$body" | jq -r '.uptime' 2>/dev/null || echo "unknown")
            
            if [ "$status" = "healthy" ]; then
                log_success "Status: $status"
                log_info "Timestamp: $timestamp"
                log_info "Uptime: ${uptime}s"
            else
                log_warning "Unexpected status: $status"
            fi
        else
            log_info "Response body: $body"
            log_warning "jq not available for JSON validation"
        fi
        
        return 0
    else
        log_error "Health check failed (HTTP $http_code)"
        if [ -n "$body" ]; then
            log_error "Response: $body"
        fi
        return 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --url)
            API_URL_OVERRIDE="$2"
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
            if [ -z "$API_URL_OVERRIDE" ]; then
                API_URL_OVERRIDE="$1"
            fi
            shift
            ;;
    esac
done

# Main execution
echo "🚀 Health Check for Effect-TS API"
echo "=================================="

if [ -n "$API_URL_OVERRIDE" ]; then
    API_URL="$API_URL_OVERRIDE"
    log_info "Using provided URL: $API_URL"
else
    get_api_url
fi

validate_tls
test_health

log_success "Health check completed successfully!"
