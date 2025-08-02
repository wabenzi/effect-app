#!/bin/bash

# Run All Tests Script
# Executes all test scripts in sequence for comprehensive validation

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUICK_MODE=false
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

# Show help
show_help() {
    echo "Run All Tests Script for Effect-TS API"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --quick      Run quick tests only (skip load testing and detailed checks)"
    echo "  --verbose    Enable verbose output"
    echo "  --help       Show this help message"
    echo ""
    echo "This script runs all test scripts in sequence:"
    echo "  1. health-check.sh     - Quick health validation"
    echo "  2. deployment-test.sh  - Infrastructure validation"
    echo "  3. api-test.sh         - API functionality testing"
    echo "  4. integration-test.sh - Local vs AWS comparison"
}

# Run a test script with error handling
run_test() {
    local script_name="$1"
    local description="$2"
    shift 2
    local args="$@"
    
    echo ""
    echo "==============================================="
    log_info "Running $description"
    echo "==============================================="
    
    if [ "$VERBOSE" = true ]; then
        log_info "Command: $SCRIPT_DIR/$script_name $args"
    fi
    
    if "$SCRIPT_DIR/$script_name" $args; then
        log_success "$description completed successfully"
        return 0
    else
        log_error "$description failed"
        return 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
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
            log_error "Unexpected argument: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
echo "🚀 Running All Tests for Effect-TS API"
echo "======================================"
echo "Quick mode: $QUICK_MODE"
echo "Verbose: $VERBOSE"
echo ""

test_results=()

# Test 1: Health Check
if run_test "health-check.sh" "Health Check"; then
    test_results+=("✅ Health Check")
else
    test_results+=("❌ Health Check")
fi

# Test 2: Deployment Test
deployment_args=""
if [ "$QUICK_MODE" = true ]; then
    deployment_args="--quick"
fi

if run_test "deployment-test.sh" "Deployment Test" $deployment_args; then
    test_results+=("✅ Deployment Test")
else
    test_results+=("❌ Deployment Test")
fi

# Test 3: API Test
api_args=""
if [ "$QUICK_MODE" = false ]; then
    api_args="--load-test"
fi
if [ "$VERBOSE" = true ]; then
    api_args="$api_args --verbose"
fi

if run_test "api-test.sh" "API Test" $api_args; then
    test_results+=("✅ API Test")
else
    test_results+=("❌ API Test")
fi

# Test 4: Integration Test
if run_test "integration-test.sh" "Integration Test"; then
    test_results+=("✅ Integration Test")
else
    test_results+=("❌ Integration Test")
fi

# Summary
echo ""
echo "==============================================="
echo "📊 TEST SUMMARY"
echo "==============================================="

all_passed=true
for result in "${test_results[@]}"; do
    echo "$result"
    if [[ "$result" == ❌* ]]; then
        all_passed=false
    fi
done

echo ""
if [ "$all_passed" = true ]; then
    log_success "🎉 All tests passed! Your Effect-TS API is working correctly."
    exit 0
else
    log_error "❌ Some tests failed. Please check the output above for details."
    exit 1
fi
