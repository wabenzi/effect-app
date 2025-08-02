#!/bin/bash

# Security Test Runner Script
# Runs comprehensive security tests and generates reports

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPORT_DIR="security-reports"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BASE_URL="${BASE_URL:-http://localhost:3000}"

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

# Create report directory
mkdir -p "$REPORT_DIR"

# Show help
show_help() {
    echo "Security Test Suite Runner"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --base-url URL     Base URL for testing (default: $BASE_URL)"
    echo "  --report-dir DIR   Directory for reports (default: $REPORT_DIR)"
    echo "  --quick            Run quick security tests only"
    echo "  --automated        Run automated security scans"
    echo "  --manual           Run manual security tests"
    echo "  --all              Run all security tests (default)"
    echo "  --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Run all security tests"
    echo "  $0 --quick                           # Quick security scan"
    echo "  $0 --base-url https://api.prod.com   # Test production"
    echo "  $0 --automated --report-dir reports  # Automated scans only"
}

# Parse command line arguments
QUICK=false
AUTOMATED=true
MANUAL=true
RUN_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --base-url)
            BASE_URL="$2"
            shift 2
            ;;
        --report-dir)
            REPORT_DIR="$2"
            shift 2
            ;;
        --quick)
            QUICK=true
            AUTOMATED=true
            MANUAL=false
            RUN_ALL=false
            shift
            ;;
        --automated)
            AUTOMATED=true
            MANUAL=false
            RUN_ALL=false
            shift
            ;;
        --manual)
            AUTOMATED=false
            MANUAL=true
            RUN_ALL=false
            shift
            ;;
        --all)
            AUTOMATED=true
            MANUAL=true
            RUN_ALL=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

log_info "Starting Security Test Suite"
log_info "Base URL: $BASE_URL"
log_info "Report Directory: $REPORT_DIR"
log_info "Timestamp: $TIMESTAMP"

# Check if server is running
log_info "Checking if server is accessible..."
if curl -s -f "$BASE_URL/health" > /dev/null; then
    log_success "Server is accessible"
else
    log_error "Server is not accessible at $BASE_URL"
    log_error "Please start the server before running security tests"
    exit 1
fi

# Function to run npm security audit
run_npm_audit() {
    log_info "Running npm security audit..."
    
    local audit_file="$REPORT_DIR/npm-audit-$TIMESTAMP.json"
    
    if npm audit --json > "$audit_file" 2>&1; then
        log_success "npm audit completed successfully"
    else
        log_warning "npm audit found vulnerabilities - check $audit_file"
    fi
    
    # Generate human-readable report
    npm audit --human-readable > "$REPORT_DIR/npm-audit-readable-$TIMESTAMP.txt" 2>&1 || true
}

# Function to run Vitest security tests
run_vitest_security_tests() {
    log_info "Running Vitest security tests..."
    
    local test_report="$REPORT_DIR/vitest-security-$TIMESTAMP.json"
    
    # Set environment variables for tests
    export BASE_URL="$BASE_URL"
    
    # Run security-specific tests
    if npx vitest run test/security/ --reporter=json > "$test_report" 2>&1; then
        log_success "Vitest security tests completed"
    else
        log_warning "Some Vitest security tests failed - check $test_report"
    fi
    
    # Generate human-readable report
    npx vitest run test/security/ --reporter=verbose > "$REPORT_DIR/vitest-security-readable-$TIMESTAMP.txt" 2>&1 || true
}

# Function to test security headers
test_security_headers() {
    log_info "Testing security headers..."
    
    local headers_file="$REPORT_DIR/security-headers-$TIMESTAMP.txt"
    
    {
        echo "=== Security Headers Test ==="
        echo "URL: $BASE_URL"
        echo "Timestamp: $(date)"
        echo ""
        
        echo "--- Health Endpoint Headers ---"
        curl -s -I "$BASE_URL/health" | grep -E "(X-Frame-Options|X-Content-Type-Options|X-XSS-Protection|Strict-Transport-Security|Content-Security-Policy|Referrer-Policy)" || echo "No security headers found"
        echo ""
        
        echo "--- CORS Test ---"
        curl -s -I -X OPTIONS "$BASE_URL/health" \
            -H "Origin: http://evil.com" \
            -H "Access-Control-Request-Method: GET" | grep -E "(Access-Control|Origin)" || echo "No CORS headers found"
        echo ""
        
    } > "$headers_file"
    
    log_success "Security headers test completed - report: $headers_file"
}

# Function to test for common vulnerabilities
test_common_vulnerabilities() {
    log_info "Testing for common vulnerabilities..."
    
    local vuln_file="$REPORT_DIR/vulnerability-scan-$TIMESTAMP.txt"
    
    {
        echo "=== Common Vulnerabilities Test ==="
        echo "URL: $BASE_URL"
        echo "Timestamp: $(date)"
        echo ""
        
        echo "--- SQL Injection Test ---"
        # Test SQL injection in email field
        curl -s -X POST "$BASE_URL/users" \
            -H "Content-Type: application/json" \
            -d '{"email":"test@example.com'\''OR 1=1--"}' | head -c 200
        echo ""
        
        echo "--- XSS Test ---"
        # Test XSS in email field
        curl -s -X POST "$BASE_URL/users" \
            -H "Content-Type: application/json" \
            -d '{"email":"<script>alert(\"xss\")</script>@example.com"}' | head -c 200
        echo ""
        
        echo "--- Path Traversal Test ---"
        curl -s "$BASE_URL/../../../etc/passwd" | head -c 200
        echo ""
        
        echo "--- Information Disclosure Test ---"
        curl -s "$BASE_URL/.env" | head -c 200
        echo ""
        curl -s "$BASE_URL/package.json" | head -c 200
        echo ""
        
    } > "$vuln_file"
    
    log_success "Vulnerability scan completed - report: $vuln_file"
}

# Function to test authentication and authorization
test_auth_security() {
    log_info "Testing authentication and authorization..."
    
    local auth_file="$REPORT_DIR/auth-security-$TIMESTAMP.txt"
    
    {
        echo "=== Authentication & Authorization Test ==="
        echo "URL: $BASE_URL"
        echo "Timestamp: $(date)"
        echo ""
        
        echo "--- Unauthenticated Access Test ---"
        echo "Testing /users/me without authentication:"
        curl -s -w "Status: %{http_code}\n" "$BASE_URL/users/me"
        echo ""
        
        echo "--- Malformed Token Test ---"
        echo "Testing with malformed token:"
        curl -s -w "Status: %{http_code}\n" -H "Cookie: token=invalid-token" "$BASE_URL/users/me"
        echo ""
        
        echo "--- Token Injection Test ---"
        echo "Testing with SQL injection in token:"
        curl -s -w "Status: %{http_code}\n" -H "Cookie: token='; DROP TABLE users; --" "$BASE_URL/users/me"
        echo ""
        
    } > "$auth_file"
    
    log_success "Authentication security test completed - report: $auth_file"
}

# Function to test rate limiting
test_rate_limiting() {
    log_info "Testing rate limiting..."
    
    local rate_file="$REPORT_DIR/rate-limiting-$TIMESTAMP.txt"
    
    {
        echo "=== Rate Limiting Test ==="
        echo "URL: $BASE_URL"
        echo "Timestamp: $(date)"
        echo ""
        
        echo "--- Rapid Request Test ---"
        echo "Making 20 rapid requests to test rate limiting..."
        
        for i in {1..20}; do
            status_code=$(curl -s -w "%{http_code}" -o /dev/null "$BASE_URL/health")
            echo "Request $i: HTTP $status_code"
            
            if [ "$status_code" = "429" ]; then
                echo "Rate limiting detected at request $i"
                break
            fi
        done
        echo ""
        
    } > "$rate_file"
    
    log_success "Rate limiting test completed - report: $rate_file"
}

# Function to run automated security scans
run_automated_scans() {
    log_info "Running automated security scans..."
    
    # npm audit
    run_npm_audit
    
    # Security headers test
    test_security_headers
    
    # Common vulnerabilities
    test_common_vulnerabilities
    
    # Authentication tests
    test_auth_security
    
    if [ "$QUICK" = false ]; then
        # Rate limiting (only in full scan)
        test_rate_limiting
    fi
}

# Function to run manual security tests
run_manual_tests() {
    log_info "Running manual security tests with Vitest..."
    
    # Run Vitest security test suite
    run_vitest_security_tests
}

# Function to generate summary report
generate_summary_report() {
    log_info "Generating summary report..."
    
    local summary_file="$REPORT_DIR/security-summary-$TIMESTAMP.txt"
    
    {
        echo "======================================"
        echo "Security Test Suite Summary Report"
        echo "======================================"
        echo "Timestamp: $(date)"
        echo "Base URL: $BASE_URL"
        echo "Report Directory: $REPORT_DIR"
        echo ""
        
        echo "--- Files Generated ---"
        ls -la "$REPORT_DIR"/*"$TIMESTAMP"* | awk '{print $9, $5 " bytes", $6, $7, $8}'
        echo ""
        
        echo "--- npm Audit Summary ---"
        if [ -f "$REPORT_DIR/npm-audit-$TIMESTAMP.json" ]; then
            jq -r '.metadata.vulnerabilities | to_entries[] | "\(.key): \(.value)"' "$REPORT_DIR/npm-audit-$TIMESTAMP.json" 2>/dev/null || echo "Could not parse npm audit results"
        else
            echo "npm audit not run"
        fi
        echo ""
        
        echo "--- Security Headers Check ---"
        if [ -f "$REPORT_DIR/security-headers-$TIMESTAMP.txt" ]; then
            grep -c "X-Frame-Options\|X-Content-Type-Options\|X-XSS-Protection\|Strict-Transport-Security" "$REPORT_DIR/security-headers-$TIMESTAMP.txt" || echo "0"
            echo " security headers found"
        fi
        echo ""
        
        echo "--- Recommendations ---"
        echo "1. Review all generated reports in $REPORT_DIR"
        echo "2. Fix any HIGH or CRITICAL vulnerabilities found"
        echo "3. Implement missing security headers"
        echo "4. Verify rate limiting is working properly"
        echo "5. Check authentication and authorization tests"
        echo ""
        
        echo "--- Next Steps ---"
        echo "1. Address identified vulnerabilities"
        echo "2. Implement additional security controls"
        echo "3. Schedule regular security testing"
        echo "4. Update security policies as needed"
        echo ""
        
    } > "$summary_file"
    
    log_success "Summary report generated: $summary_file"
    
    # Display summary to console
    cat "$summary_file"
}

# Main execution
if [ "$AUTOMATED" = true ]; then
    run_automated_scans
fi

if [ "$MANUAL" = true ]; then
    run_manual_tests
fi

# Generate summary
generate_summary_report

log_success "Security test suite completed!"
log_info "All reports available in: $REPORT_DIR"

# Set exit code based on critical findings
if grep -q "CRITICAL\|HIGH" "$REPORT_DIR"/*"$TIMESTAMP"* 2>/dev/null; then
    log_warning "Critical or high-severity issues found!"
    log_warning "Review reports and address issues before production deployment"
    exit 1
else
    log_success "No critical security issues detected"
    exit 0
fi
