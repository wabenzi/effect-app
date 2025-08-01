import { describe, it, expect } from 'vitest'

const BASE_URL = 'http://localhost:3000'

// Helper function to make HTTP requests
async function makeRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<{
  status: number
  data: any
  headers: Headers
}> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
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

describe('API Integration Tests', () => {
  it('should create user, authenticate, and create group in sequence', async () => {
    // Step 1: Create a user
    const timestamp = Date.now()
    const email = `integration-${timestamp}@example.com`
    
    const userResponse = await makeRequest('/users', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })

    expect(userResponse.status).toBe(200)
    expect(userResponse.data).toHaveProperty('id')
    expect(userResponse.data).toHaveProperty('email', email)

    // Step 2: Extract session cookie
    const sessionCookie = extractSessionCookie(userResponse.headers)
    expect(sessionCookie).toBeTruthy()
    
    console.log('User created successfully:', userResponse.data.email)
    console.log('Session cookie:', sessionCookie)

    // Step 3: Create a group with authentication - using exact curl format
    const groupPayload = JSON.stringify({ name: `Test Group ${timestamp}` })
    console.log('Group payload:', groupPayload)
    console.log('Payload length:', groupPayload.length)
    
    const groupResponse = await makeRequest('/groups', {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        // Explicitly set Content-Type to match curl exactly
        'Content-Type': 'application/json',
      },
      body: groupPayload,
    })

    console.log('Group creation response:', {
      status: groupResponse.status,
      data: groupResponse.data
    })

    expect(groupResponse.status).toBe(200)
    expect(groupResponse.data).toHaveProperty('id')
    expect(groupResponse.data).toHaveProperty('name', `Test Group ${timestamp}`)
    expect(groupResponse.data).toHaveProperty('ownerId')

    console.log('Group created successfully:', groupResponse.data.name)
  })

  it('should reject unauthenticated requests', async () => {
    const response = await makeRequest('/users/me', {
      method: 'GET',
    })

    expect(response.status).toBe(403)
    console.log('Unauthenticated request properly rejected')
  })

  it('should respond to health checks', async () => {
    const response = await makeRequest('/health')
    expect(response.status).toBe(200)
    console.log('Health check passed')
  })
})
