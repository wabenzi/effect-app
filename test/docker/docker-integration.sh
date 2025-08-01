#!/bin/bash

# Docker-based integration testing script
# This script builds, deploys, tests, and destroys the Docker container
set -e

DOCKER_IMAGE_NAME="effect-app"
DOCKER_CONTAINER_NAME="effect-app-test"
DOCKER_PORT="3000"
HOST_PORT="3001"  # Use different port to avoid conflicts with local dev server
BASE_URL="http://localhost:${HOST_PORT}"
MAX_WAIT_TIME=60
CONTAINER_ID=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to clean up Docker resources
cleanup_docker() {
    if [ -n "$CONTAINER_ID" ]; then
        log_info "Stopping and removing container: $CONTAINER_ID"
        docker stop "$CONTAINER_ID" >/dev/null 2>&1 || true
        docker rm "$CONTAINER_ID" >/dev/null 2>&1 || true
    fi
    
    # Clean up any dangling containers with our name
    docker ps -a --filter "name=$DOCKER_CONTAINER_NAME" --format "{{.ID}}" | while read -r id; do
        if [ -n "$id" ]; then
            log_info "Cleaning up existing container: $id"
            docker stop "$id" >/dev/null 2>&1 || true
            docker rm "$id" >/dev/null 2>&1 || true
        fi
    done
}

# Function to build the application
build_app() {
    log_info "Building TypeScript application..."
    npm run build
    
    if [ ! -d "dist" ] || [ -z "$(ls -A dist)" ]; then
        log_error "Build failed: dist directory is missing or empty"
        exit 1
    fi
    
    log_success "Application built successfully"
}

# Function to build Docker image
build_docker_image() {
    log_info "Building Docker image: $DOCKER_IMAGE_NAME"
    
    # Remove existing image if it exists
    docker rmi "$DOCKER_IMAGE_NAME" >/dev/null 2>&1 || true
    
    # Build new image
    docker build -t "$DOCKER_IMAGE_NAME" .
    
    if [ $? -eq 0 ]; then
        log_success "Docker image built successfully"
    else
        log_error "Docker image build failed"
        exit 1
    fi
}

# Function to start Docker container
start_container() {
    log_info "Starting Docker container..."
    
    # Check if port is already in use
    if netstat -ln | grep -q ":${HOST_PORT} "; then
        log_error "Port $HOST_PORT is already in use"
        exit 1
    fi
    
    CONTAINER_ID=$(docker run -d \
        --name "$DOCKER_CONTAINER_NAME" \
        -p "${HOST_PORT}:${DOCKER_PORT}" \
        "$DOCKER_IMAGE_NAME")
    
    if [ $? -eq 0 ]; then
        log_success "Container started with ID: $CONTAINER_ID"
        log_info "Container accessible at: $BASE_URL"
    else
        log_error "Failed to start container"
        exit 1
    fi
}

# Function to wait for container to be healthy
wait_for_health() {
    log_info "Waiting for container to be healthy..."
    
    local wait_time=0
    local health_status=""
    
    while [ $wait_time -lt $MAX_WAIT_TIME ]; do
        # Check container health status
        health_status=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_ID" 2>/dev/null || echo "no-health-check")
        
        if [ "$health_status" = "healthy" ]; then
            log_success "Container is healthy!"
            return 0
        elif [ "$health_status" = "unhealthy" ]; then
            log_error "Container is unhealthy!"
            show_container_logs
            return 1
        fi
        
        # Also check if we can reach the health endpoint directly
        if curl -f -s "${BASE_URL}/health" >/dev/null 2>&1; then
            log_success "Health endpoint is responding!"
            return 0
        fi
        
        sleep 2
        wait_time=$((wait_time + 2))
        echo -n "."
    done
    
    echo ""
    log_error "Container failed to become healthy within ${MAX_WAIT_TIME} seconds"
    show_container_logs
    return 1
}

# Function to show container logs
show_container_logs() {
    log_info "Container logs:"
    echo "===================="
    docker logs "$CONTAINER_ID" 2>&1 | tail -20
    echo "===================="
}

# Function to run integration tests
run_integration_tests() {
    log_info "Running integration tests against Docker container..."
    
    # Create a temporary test script that uses the correct base URL
    cat > /tmp/docker-integration-test.js << EOF
const BASE_URL = "${BASE_URL}";

async function makeRequest(endpoint, options = {}) {
  const response = await fetch(\`\${BASE_URL}\${endpoint}\`, {
    headers: {
      ...options.headers,
      'Content-Type': 'application/json'
    },
    ...options
  });
  
  const data = await response.text();
  let parsedData;
  try {
    parsedData = JSON.parse(data);
  } catch {
    parsedData = data;
  }
  
  return {
    status: response.status,
    data: parsedData,
    headers: Object.fromEntries(response.headers.entries())
  };
}

async function runTests() {
  console.log('🚀 Starting Docker integration tests...');
  
  try {
    // Test 1: Health check
    console.log('\\n1. Testing health endpoint...');
    const healthResponse = await makeRequest('/health');
    if (healthResponse.status !== 200) {
      throw new Error(\`Health check failed: \${healthResponse.status}\`);
    }
    console.log('✅ Health check passed');
    
    // Test 2: Create user
    console.log('\\n2. Testing user creation...');
    const userResponse = await makeRequest('/users', {
      method: 'POST',
      body: JSON.stringify({
        email: \`docker-test-\${Date.now()}@example.com\`
      })
    });
    
    if (userResponse.status !== 200) {
      throw new Error(\`User creation failed: \${userResponse.status} - \${JSON.stringify(userResponse.data)}\`);
    }
    console.log('✅ User creation passed');
    
    // Extract session cookie
    const setCookieHeader = userResponse.headers['set-cookie'];
    if (!setCookieHeader) {
      throw new Error('No session cookie received');
    }
    
    const sessionCookie = setCookieHeader.split(';')[0];
    console.log(\`Session cookie: \${sessionCookie}\`);
    
    // Test 3: Create group with authentication
    console.log('\\n3. Testing authenticated group creation...');
    const groupPayload = JSON.stringify({ name: \`Docker Test Group \${Date.now()}\` });
    console.log('Sending group payload:', groupPayload);
    console.log('Payload length:', groupPayload.length);
    
    const groupResponse = await makeRequest('/groups', {
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/json'
      },
      body: groupPayload
    });
    
    console.log('Response status:', groupResponse.status);
    console.log('Response data:', JSON.stringify(groupResponse.data, null, 2));
    
    if (groupResponse.status !== 200) {
      throw new Error(\`Group creation failed: \${groupResponse.status} - \${JSON.stringify(groupResponse.data)}\`);
    }
    console.log('✅ Authenticated group creation passed');
    console.log('Group created:', JSON.stringify(groupResponse.data, null, 2));
    
    // Test 4: Unauthenticated request should fail
    console.log('\\n4. Testing unauthenticated request rejection...');
    const unauthResponse = await makeRequest('/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unauthorized Group'
      })
    });
    
    if (unauthResponse.status !== 403) {
      throw new Error(\`Expected 403 for unauthenticated request, got: \${unauthResponse.status}\`);
    }
    console.log('✅ Unauthenticated request properly rejected');
    
    console.log('\\n🎉 All Docker integration tests passed!');
    return 0;
    
  } catch (error) {
    console.error('\\n❌ Docker integration test failed:');
    console.error(error.message);
    return 1;
  }
}

runTests().then(code => process.exit(code));
EOF

    # Run the test
    node /tmp/docker-integration-test.js
    local test_result=$?
    
    # Clean up temporary file
    rm -f /tmp/docker-integration-test.js
    
    return $test_result
}

# Function to show container stats
show_container_stats() {
    log_info "Container statistics:"
    echo "===================="
    docker stats "$CONTAINER_ID" --no-stream
    echo "===================="
}

# Trap to ensure cleanup on script exit
trap cleanup_docker EXIT

# Main execution
case "${1:-all}" in
    "build")
        build_app
        build_docker_image
        ;;
    "start")
        cleanup_docker
        start_container
        wait_for_health
        log_success "Container is running and healthy!"
        log_info "Access the API at: $BASE_URL"
        log_info "View logs with: docker logs $CONTAINER_ID"
        log_info "Stop with: docker stop $CONTAINER_ID"
        # Keep container running
        read -p "Press Enter to stop the container..."
        ;;
    "test")
        build_app
        build_docker_image
        cleanup_docker
        start_container
        wait_for_health
        show_container_stats
        run_integration_tests
        ;;
    "logs")
        if [ -n "$2" ]; then
            docker logs "$2"
        else
            log_error "Please provide container ID: $0 logs <container_id>"
        fi
        ;;
    "clean")
        cleanup_docker
        docker rmi "$DOCKER_IMAGE_NAME" >/dev/null 2>&1 || true
        log_success "Docker resources cleaned up"
        ;;
    "all"|*)
        build_app
        build_docker_image
        cleanup_docker
        start_container
        wait_for_health
        show_container_stats
        run_integration_tests
        ;;
esac
