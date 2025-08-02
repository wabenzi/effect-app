import { describe, it, expect, beforeAll } from 'vitest'

// AWS-specific configuration
const getAwsApiUrl = async (): Promise<string> => {
  // Try to get API URL from environment variable first
  const envUrl = process.env.AWS_API_URL
  if (envUrl) {
    return envUrl
  }

  // If not provided, try to get from CloudFormation stack
  try {
    const { execSync } = await import('child_process')
    const command = `aws cloudformation describe-stacks --stack-name EffectAppStack --region ${process.env.AWS_REGION || 'us-west-2'} --query 'Stacks[0].Outputs[?OutputKey==\`ApiGatewayUrl\`].OutputValue' --output text`
    const apiUrl = execSync(command, { encoding: 'utf-8' }).trim()
    
    if (!apiUrl || apiUrl === 'None') {
      throw new Error('No API URL found in CloudFormation stack')
    }
    
    return apiUrl
  } catch (error) {
    throw new Error(`Failed to get AWS API URL: ${error}. Please set AWS_API_URL environment variable or ensure the stack is deployed.`)
  }
}

let AWS_API_URL: string

beforeAll(async () => {
  AWS_API_URL = await getAwsApiUrl()
  console.log('Testing AWS deployment at:', AWS_API_URL)
}, 10000) // 10 second timeout for getting API URL

// Helper function to make HTTP requests to AWS API
async function makeAwsRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<{
  status: number
  data: any
  headers: Headers
}> {
  const response = await fetch(`${AWS_API_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  let data
  const contentType = response.headers.get('content-type')
  
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json()
    } catch {
      data = null
    }
  } else {
    try {
      data = await response.text()
    } catch {
      data = null
    }
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  }
}

// Helper to extract session cookie from Set-Cookie header
function extractSessionCookie(headers: Headers): string | null {
  const setCookie = headers.get('set-cookie')
  if (!setCookie) return null
  
  const tokenMatch = setCookie.match(/token=([^;]+)/)
  return tokenMatch ? `token=${tokenMatch[1]}` : null
}

describe('AWS API Integration Tests', () => {
  it('should respond to health checks on AWS', async () => {
    console.log('Testing AWS health endpoint...')
    
    const response = await makeAwsRequest('/health')
    expect(response.status).toBe(200)
    expect(response.data).toHaveProperty('status', 'healthy')
    expect(response.data).toHaveProperty('timestamp')
    expect(response.data).toHaveProperty('uptime')
    
    console.log('AWS health check passed:', response.data)
  }, 15000)

  it('should create user, authenticate, and create group in sequence on AWS', async () => {
    console.log('Testing complete user flow on AWS...')
    
    // Step 1: Create a user
    const timestamp = Date.now()
    const email = `aws-integration-${timestamp}@example.com`
    
    const userResponse = await makeAwsRequest('/users', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })

    expect(userResponse.status).toBe(200)
    expect(userResponse.data).toHaveProperty('id')
    expect(userResponse.data).toHaveProperty('email', email)
    expect(userResponse.data).toHaveProperty('accessToken')
    expect(userResponse.data).toHaveProperty('account')

    console.log('AWS user created successfully:', userResponse.data.email)

    // Step 2: Extract session cookie
    const sessionCookie = extractSessionCookie(userResponse.headers)
    expect(sessionCookie).toBeTruthy()
    
    console.log('AWS session cookie extracted:', sessionCookie)

    // Step 3: Create a group with authentication
    const groupPayload = JSON.stringify({ name: `AWS Test Group ${timestamp}` })
    console.log('Sending group payload to AWS:', groupPayload)
    
    const groupResponse = await makeAwsRequest('/groups', {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: groupPayload,
    })

    console.log('AWS group creation response:', {
      status: groupResponse.status,
      data: groupResponse.data
    })

    expect(groupResponse.status).toBe(200)
    expect(groupResponse.data).toHaveProperty('id')
    expect(groupResponse.data).toHaveProperty('name', `AWS Test Group ${timestamp}`)
    expect(groupResponse.data).toHaveProperty('ownerId')
    expect(groupResponse.data).toHaveProperty('createdAt')
    expect(groupResponse.data).toHaveProperty('updatedAt')

    console.log('AWS group created successfully:', groupResponse.data.name)
  }, 30000) // 30 second timeout for full flow

  it('should reject unauthenticated requests on AWS', async () => {
    console.log('Testing unauthenticated request rejection on AWS...')
    
    const response = await makeAwsRequest('/users/me', {
      method: 'GET',
    })

    expect(response.status).toBe(403)
    expect(response.data).toHaveProperty('_tag', 'Unauthorized')
    
    console.log('AWS unauthenticated request properly rejected')
  }, 15000)

  it('should handle CORS properly on AWS', async () => {
    console.log('Testing CORS on AWS...')
    
    // Test preflight request
    const preflightResponse = await makeAwsRequest('/users', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })

    // Preflight should succeed
    expect([200, 204]).toContain(preflightResponse.status)
    
    // Check for CORS headers in a regular request
    const healthResponse = await makeAwsRequest('/health', {
      headers: {
        'Origin': 'https://example.com',
      },
    })
    
    expect(healthResponse.status).toBe(200)
    
    // Check for CORS headers (API Gateway should add these)
    const corsHeaders = healthResponse.headers.get('access-control-allow-origin')
    console.log('AWS CORS headers:', {
      'access-control-allow-origin': corsHeaders,
      'access-control-allow-methods': healthResponse.headers.get('access-control-allow-methods'),
      'access-control-allow-headers': healthResponse.headers.get('access-control-allow-headers'),
    })
    
    console.log('AWS CORS test completed')
  }, 15000)

  it('should handle high load on AWS', async () => {
    console.log('Testing load handling on AWS...')
    
    const concurrentRequests = 10
    const requests = Array.from({ length: concurrentRequests }, (_, i) => 
      makeAwsRequest('/health').then(response => ({
        requestId: i + 1,
        status: response.status,
        duration: Date.now() // Simple timestamp
      }))
    )

    const results = await Promise.all(requests)
    
    // All requests should succeed
    results.forEach(result => {
      expect(result.status).toBe(200)
    })
    
    const successCount = results.filter(r => r.status === 200).length
    expect(successCount).toBe(concurrentRequests)
    
    console.log(`AWS load test passed: ${successCount}/${concurrentRequests} requests succeeded`)
  }, 30000)

  it('should maintain consistent response times on AWS', async () => {
    console.log('Testing response time consistency on AWS...')
    
    const measurements: number[] = []
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now()
      const response = await makeAwsRequest('/health')
      const end = Date.now()
      const duration = end - start
      
      expect(response.status).toBe(200)
      measurements.push(duration)
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    const avgResponseTime = measurements.reduce((a, b) => a + b, 0) / measurements.length
    const maxResponseTime = Math.max(...measurements)
    const minResponseTime = Math.min(...measurements)
    
    console.log('AWS response time stats:', {
      average: `${avgResponseTime.toFixed(2)}ms`,
      min: `${minResponseTime}ms`,
      max: `${maxResponseTime}ms`,
      measurements: measurements.map(m => `${m}ms`)
    })
    
    // Reasonable response time expectations for AWS (adjust as needed)
    expect(avgResponseTime).toBeLessThan(5000) // Average under 5 seconds
    expect(maxResponseTime).toBeLessThan(10000) // Max under 10 seconds
    
    console.log('AWS response time consistency test passed')
  }, 60000) // 1 minute timeout for multiple requests

  it('should return proper API Gateway headers on AWS', async () => {
    console.log('Testing API Gateway headers on AWS...')
    
    const response = await makeAwsRequest('/health')
    expect(response.status).toBe(200)
    
    // Check for API Gateway specific headers
    const headers = Object.fromEntries(response.headers.entries())
    console.log('AWS response headers:', headers)
    
    // API Gateway typically adds these headers
    expect(headers).toHaveProperty('date')
    expect(headers).toHaveProperty('content-type')
    
    // Check if X-Ray tracing header is present (if enabled)
    if (headers['x-amzn-trace-id']) {
      console.log('AWS X-Ray tracing enabled:', headers['x-amzn-trace-id'])
    }
    
    console.log('AWS API Gateway headers test completed')
  }, 15000)
})
