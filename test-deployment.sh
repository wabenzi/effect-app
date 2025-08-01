#!/bin/bash

# Test deployment script for Effect-TS HTTP API on AWS Fargate

set -e

REGION="us-west-2"
STACK_NAME="effect-app-fargate"

echo "🧪 Testing deployed Effect-TS HTTP API"

# Get the Application Load Balancer URL
echo "📡 Getting Load Balancer URL..."
ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerURL`].OutputValue' \
  --output text)

if [ -z "$ALB_URL" ]; then
  echo "❌ Could not retrieve Load Balancer URL"
  exit 1
fi

echo "🌐 Testing API at: $ALB_URL"

# Test health endpoint
echo "🔍 Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/health_response.json "$ALB_URL/health")
HEALTH_STATUS=$(echo $HEALTH_RESPONSE | tail -c 4)

if [ "$HEALTH_STATUS" = "200" ]; then
  echo "✅ Health check passed"
  cat /tmp/health_response.json
else
  echo "❌ Health check failed with status: $HEALTH_STATUS"
  cat /tmp/health_response.json
  exit 1
fi

echo ""

# Test user creation (should work without auth)
echo "👤 Testing user creation..."
USER_PAYLOAD='{"email":"test@example.com","name":"Test User"}'
CREATE_USER_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/user_response.json \
  -H "Content-Type: application/json" \
  -d "$USER_PAYLOAD" \
  "$ALB_URL/accounts/users")

CREATE_USER_STATUS=$(echo $CREATE_USER_RESPONSE | tail -c 4)

if [ "$CREATE_USER_STATUS" = "201" ]; then
  echo "✅ User creation passed"
  cat /tmp/user_response.json | jq .
else
  echo "❌ User creation failed with status: $CREATE_USER_STATUS"
  cat /tmp/user_response.json
fi

echo ""

# Test group creation (should require auth)
echo "🏢 Testing group creation (should fail without auth)..."
GROUP_PAYLOAD='{"name":"Test Group","description":"A test group"}'
CREATE_GROUP_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/group_response.json \
  -H "Content-Type: application/json" \
  -d "$GROUP_PAYLOAD" \
  "$ALB_URL/groups")

CREATE_GROUP_STATUS=$(echo $CREATE_GROUP_RESPONSE | tail -c 4)

if [ "$CREATE_GROUP_STATUS" = "401" ] || [ "$CREATE_GROUP_STATUS" = "403" ]; then
  echo "✅ Group creation correctly requires authentication"
  cat /tmp/group_response.json
else
  echo "⚠️  Group creation status: $CREATE_GROUP_STATUS (expected 401/403)"
  cat /tmp/group_response.json
fi

echo ""
echo "🎉 API testing completed!"
echo "📊 Results:"
echo "  - Health endpoint: $([ "$HEALTH_STATUS" = "200" ] && echo "✅ Pass" || echo "❌ Fail")"
echo "  - User creation: $([ "$CREATE_USER_STATUS" = "201" ] && echo "✅ Pass" || echo "❌ Fail")"
echo "  - Auth protection: $([ "$CREATE_GROUP_STATUS" = "401" ] || [ "$CREATE_GROUP_STATUS" = "403" ] && echo "✅ Pass" || echo "❌ Fail")"

# Cleanup temp files
rm -f /tmp/health_response.json /tmp/user_response.json /tmp/group_response.json
