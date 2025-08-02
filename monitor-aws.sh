#!/bin/bash

# AWS Service Monitoring Script
# Monitors the health and performance of the deployed Effect-TS application

set -e

# Configuration
STACK_NAME="EffectAppStack"
AWS_REGION="${AWS_REGION:-us-west-2}"
INTERVAL="${INTERVAL:-30}"
DURATION="${DURATION:-300}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

# Get stack outputs
get_stack_outputs() {
    aws cloudformation describe-stacks \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs' \
        --output json 2>/dev/null || echo "[]"
}

# Get specific output value
get_output_value() {
    local key=$1
    local outputs=$(get_stack_outputs)
    echo "$outputs" | jq -r ".[] | select(.OutputKey==\"$key\") | .OutputValue" 2>/dev/null || echo ""
}

# Monitor ECS service
monitor_ecs_service() {
    local cluster_name=$(get_output_value "ClusterName")
    local service_name=$(get_output_value "ServiceName")
    
    if [ -z "$cluster_name" ] || [ -z "$service_name" ]; then
        log_error "Could not retrieve ECS cluster or service name"
        return 1
    fi
    
    # Get service details
    local service_info=$(aws ecs describe-services \
        --cluster $cluster_name \
        --services $service_name \
        --region $AWS_REGION \
        --query 'services[0]' \
        --output json 2>/dev/null)
    
    if [ -z "$service_info" ] || [ "$service_info" = "null" ]; then
        log_error "Could not retrieve ECS service information"
        return 1
    fi
    
    local service_status=$(echo "$service_info" | jq -r '.status')
    local running_count=$(echo "$service_info" | jq -r '.runningCount')
    local desired_count=$(echo "$service_info" | jq -r '.desiredCount')
    local pending_count=$(echo "$service_info" | jq -r '.pendingCount')
    
    echo -e "${BLUE}ECS Service Status:${NC}"
    echo "  Status: $service_status"
    echo "  Running: $running_count"
    echo "  Desired: $desired_count"
    echo "  Pending: $pending_count"
    
    if [ "$service_status" = "ACTIVE" ] && [ "$running_count" -eq "$desired_count" ] && [ "$running_count" -gt 0 ]; then
        log_success "ECS service is healthy"
        return 0
    else
        log_warning "ECS service may have issues"
        return 1
    fi
}

# Monitor API Gateway
monitor_api_gateway() {
    local api_url=$(get_output_value "ApiGatewayUrl")
    
    if [ -z "$api_url" ]; then
        log_error "Could not retrieve API Gateway URL"
        return 1
    fi
    
    # Test health endpoint
    local start_time=$(date +%s)
    local response=$(curl -s -w "HTTPSTATUS:%{http_code};TIME:%{time_total}" "$api_url/health" 2>/dev/null)
    local end_time=$(date +%s)
    
    local http_code=$(echo $response | sed -n 's/.*HTTPSTATUS:\([0-9]*\).*/\1/p')
    local response_time=$(echo $response | sed -n 's/.*TIME:\([0-9.]*\).*/\1/p')
    local body=$(echo $response | sed 's/HTTPSTATUS:.*//g')
    
    echo -e "${BLUE}API Gateway Health:${NC}"
    echo "  URL: $api_url"
    echo "  HTTP Status: $http_code"
    echo "  Response Time: ${response_time}s"
    
    if [ "$http_code" = "200" ]; then
        log_success "API Gateway health check passed"
        return 0
    else
        log_error "API Gateway health check failed (status: $http_code)"
        return 1
    fi
}

# Monitor CloudWatch metrics
monitor_cloudwatch_metrics() {
    local cluster_name=$(get_output_value "ClusterName")
    local service_name=$(get_output_value "ServiceName")
    
    if [ -z "$cluster_name" ] || [ -z "$service_name" ]; then
        return 1
    fi
    
    # Get CPU and Memory utilization (last 5 minutes)
    local end_time=$(date -u +%Y-%m-%dT%H:%M:%S)
    local start_time=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)
    
    echo -e "${BLUE}CloudWatch Metrics (last 5 minutes):${NC}"
    
    # CPU Utilization
    local cpu_data=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/ECS \
        --metric-name CPUUtilization \
        --dimensions Name=ServiceName,Value=$service_name Name=ClusterName,Value=$cluster_name \
        --start-time $start_time \
        --end-time $end_time \
        --period 300 \
        --statistics Average \
        --region $AWS_REGION \
        --output json 2>/dev/null)
    
    if [ -n "$cpu_data" ] && [ "$cpu_data" != "null" ]; then
        local cpu_avg=$(echo "$cpu_data" | jq -r '.Datapoints | if length > 0 then (map(.Average) | add / length | . * 100 / 100) else "N/A" end')
        echo "  CPU Utilization: ${cpu_avg}%"
    fi
    
    # Memory Utilization
    local memory_data=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/ECS \
        --metric-name MemoryUtilization \
        --dimensions Name=ServiceName,Value=$service_name Name=ClusterName,Value=$cluster_name \
        --start-time $start_time \
        --end-time $end_time \
        --period 300 \
        --statistics Average \
        --region $AWS_REGION \
        --output json 2>/dev/null)
    
    if [ -n "$memory_data" ] && [ "$memory_data" != "null" ]; then
        local memory_avg=$(echo "$memory_data" | jq -r '.Datapoints | if length > 0 then (map(.Average) | add / length | . * 100 / 100) else "N/A" end')
        echo "  Memory Utilization: ${memory_avg}%"
    fi
}

# Monitor recent logs
monitor_logs() {
    local log_group="/ecs/effect-app-fargate"
    
    # Get recent log events (last 5 minutes)
    local start_time=$(($(date +%s) * 1000 - 300000))
    
    echo -e "${BLUE}Recent Logs (last 5 minutes):${NC}"
    
    local logs=$(aws logs filter-log-events \
        --log-group-name $log_group \
        --start-time $start_time \
        --region $AWS_REGION \
        --query 'events[*].message' \
        --output text 2>/dev/null | tail -5)
    
    if [ -n "$logs" ]; then
        echo "$logs" | sed 's/^/  /'
    else
        echo "  No recent logs found"
    fi
}

# Single monitoring check
single_check() {
    echo -e "${GREEN}=== Effect-TS AWS Monitoring $(date) ===${NC}\n"
    
    monitor_ecs_service
    echo ""
    
    monitor_api_gateway
    echo ""
    
    monitor_cloudwatch_metrics
    echo ""
    
    monitor_logs
    echo ""
}

# Continuous monitoring
continuous_monitoring() {
    log_info "Starting continuous monitoring (interval: ${INTERVAL}s, duration: ${DURATION}s)"
    
    local end_time=$(($(date +%s) + $DURATION))
    
    while [ $(date +%s) -lt $end_time ]; do
        single_check
        echo "----------------------------------------"
        sleep $INTERVAL
    done
    
    log_info "Monitoring completed"
}

# Show alerts for unhealthy services
check_alerts() {
    echo -e "${YELLOW}=== Health Alerts ===${NC}"
    
    local issues=0
    
    # Check ECS service
    if ! monitor_ecs_service >/dev/null 2>&1; then
        log_error "ECS service is unhealthy"
        issues=$((issues + 1))
    fi
    
    # Check API Gateway
    if ! monitor_api_gateway >/dev/null 2>&1; then
        log_error "API Gateway is unhealthy"
        issues=$((issues + 1))
    fi
    
    if [ $issues -eq 0 ]; then
        log_success "All services are healthy"
    else
        log_error "Found $issues issues"
        exit 1
    fi
}

# Show help
show_help() {
    echo "AWS Service Monitoring Script for Effect-TS Application"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  check       Single health check (default)"
    echo "  monitor     Continuous monitoring"
    echo "  alerts      Check for alerts only"
    echo "  help        Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION  AWS region (default: us-west-2)"
    echo "  INTERVAL    Monitoring interval in seconds (default: 30)"
    echo "  DURATION    Monitoring duration in seconds (default: 300)"
    echo ""
    echo "Examples:"
    echo "  $0 check                           # Single check"
    echo "  $0 monitor                         # Monitor for 5 minutes"
    echo "  INTERVAL=60 DURATION=600 $0 monitor # Monitor for 10 minutes, 60s intervals"
    echo "  $0 alerts                          # Check alerts only"
}

# Main script logic
case "${1:-check}" in
    check)
        single_check
        ;;
    monitor)
        continuous_monitoring
        ;;
    alerts)
        check_alerts
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
