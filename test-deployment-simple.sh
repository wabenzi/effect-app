#!/bin/bash

# Simple AWS Deployment Test Script
# Tests basic functionality of the deployed Effect-TS HTTP API on AWS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if base URL is provided
if [ -z "$1" ]; then
    echo -e "${RED}Usage: $0 <base-url>${NC}"
    echo -e "${YELLOW}Example: $0 https://your-load-balancer-url.us-west-2.elb.amazonaws.com${NC}"
    exit 1
fi

BASE_URL="$1"
COOKIE_JAR=$(mktemp)
TEST_EMAIL="test-$(date +%s)@example.com"

# Cleanup function
cleanup() {
    rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo -e "${BLUE}🚀 Testing AWS Deployment: $BASE_URL${NC}"
echo "========================================"

# Test 1: Health Check
echo -e "\n${YELLOW}Test 1: Health Check${NC}"
health_status=$(curl -s -w "%{http_code}" -o /dev/null "$BASE_URL/health" || echo "000")
if [ "$health_status" = "204" ] || [ "$health_status" = "200" ]; then
    echo -e "${GREEN}✅ Health check passed (status: $health_status)${NC}"
else
    echo -e "${YELLOW}⚠️  Health endpoint returned status: $health_status${NC}"
fi

# Test 2: Create User
echo -e "\n${YELLOW}Test 2: Create User${NC}"
echo "Creating user with email: $TEST_EMAIL"

create_response=$(curl -s -w "%{http_code}" -c "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"email\":\"$TEST_EMAIL\"}" \
    "$BASE_URL/users")

status_code="${create_response: -3}"
response_body="${create_response%???}"

if [ "$status_code" = "200" ]; then
    echo -e "${GREEN}✅ User created successfully${NC}"
    echo "$response_body"
else
    echo -e "${RED}❌ Failed to create user (status: $status_code)${NC}"
    echo "$response_body"
    exit 1
fi

# Test 3: Get Current User (authenticated)
echo -e "\n${YELLOW}Test 3: Get Current User (authenticated)${NC}"

me_response=$(curl -s -w "%{http_code}" -b "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    "$BASE_URL/users/me")

status_code="${me_response: -3}"
response_body="${me_response%???}"

if [ "$status_code" = "200" ]; then
    echo -e "${GREEN}✅ Successfully retrieved current user${NC}"
    echo "$response_body"
else
    echo -e "${RED}❌ Failed to get current user (status: $status_code)${NC}"
    echo "$response_body"
fi

# Test 4: Create Group (authenticated)
echo -e "\n${YELLOW}Test 4: Create Group (authenticated)${NC}"

group_response=$(curl -s -w "%{http_code}" -b "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{\"name\":\"Test Group\"}" \
    "$BASE_URL/groups")

status_code="${group_response: -3}"
response_body="${group_response%???}"

if [ "$status_code" = "200" ]; then
    echo -e "${GREEN}✅ Group created successfully${NC}"
    echo "$response_body"
else
    echo -e "${RED}❌ Failed to create group (status: $status_code)${NC}"
    echo "$response_body"
fi

# Test 5: Test Unauthenticated Access
echo -e "\n${YELLOW}Test 5: Test Unauthenticated Access (should fail)${NC}"

unauth_response=$(curl -s -w "%{http_code}" \
    -H "Content-Type: application/json" \
    "$BASE_URL/users/me")

status_code="${unauth_response: -3}"

if [ "$status_code" = "401" ] || [ "$status_code" = "403" ]; then
    echo -e "${GREEN}✅ Correctly rejected unauthenticated request (status: $status_code)${NC}"
else
    echo -e "${YELLOW}⚠️  Unexpected response for unauthenticated request (status: $status_code)${NC}"
fi

echo -e "\n${BLUE}🎉 Basic deployment testing completed!${NC}"
echo "========================================"
