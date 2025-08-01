#!/bin/bash

# Server lifecycle management for integration tests
set -e

SERVER_PID=""
BASE_URL="http://localhost:3000"
MAX_WAIT_TIME=30

#!/bin/bash

# Server lifecycle management for integration tests
set -e

SERVER_PID=""
BASE_URL="http://localhost:3000"
MAX_WAIT_TIME=30

# Function to start the server
start_server() {
    echo "Starting development server..."
    
    # Start server in background and capture PID
    npm run dev > server.log 2>&1 &
    SERVER_PID=$!
    
    echo "Server PID: $SERVER_PID"
    
    # Wait for server to be ready by checking health endpoint
    echo "Waiting for server to start..."
    local wait_time=0
    
    while ! curl -f -s "${BASE_URL}/health" > /dev/null 2>&1; do
        if [ $wait_time -ge $MAX_WAIT_TIME ]; then
            echo "Server failed to start within ${MAX_WAIT_TIME} seconds"
            echo "Server log output:"
            cat server.log
            stop_server
            exit 1
        fi
        
        sleep 1
        wait_time=$((wait_time + 1))
        echo "Waiting... ${wait_time}s"
    done
    
    echo "Server is ready at ${BASE_URL}"
    echo "Health check response:"
    curl -s "${BASE_URL}/health" | jq . || curl -s "${BASE_URL}/health"
}

# Function to stop the server
stop_server() {
    if [ -n "$SERVER_PID" ]; then
        echo "Stopping server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        echo "Server stopped"
    fi
    
    # Clean up log file
    rm -f server.log
}

# Function to run integration tests
run_tests() {
    echo "Running integration tests..."
    vitest run test/integration/client-tests
}

# Trap to ensure server is stopped on script exit
trap stop_server EXIT

# Main execution
case "${1:-all}" in
    "start")
        start_server
        echo "Server started successfully. PID: $SERVER_PID"
        echo "Run 'kill $SERVER_PID' to stop the server manually."
        wait $SERVER_PID
        ;;
    "stop")
        stop_server
        ;;
    "test")
        start_server
        run_tests
        ;;
    "all"|*)
        start_server
        run_tests
        ;;
esac
