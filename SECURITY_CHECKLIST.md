# Security Testing Checklist

## Authentication & Authorization Tests

### ✅ Token Security
- [ ] Test token generation randomness
- [ ] Verify token expiration enforcement  
- [ ] Test token revocation
- [ ] Validate secure token storage (hashed)
- [ ] Test session fixation prevention

### ✅ Authorization
- [ ] Test policy enforcement on all endpoints
- [ ] Verify role-based access control
- [ ] Test privilege escalation prevention
- [ ] Validate cross-user data access prevention

## Input Validation Tests

### ✅ Injection Attacks
- [ ] SQL injection prevention
- [ ] XSS prevention in all inputs
- [ ] Command injection prevention
- [ ] LDAP injection prevention

### ✅ Data Validation
- [ ] Email format validation
- [ ] Name field security
- [ ] File upload validation (if applicable)
- [ ] JSON payload validation

## Infrastructure Security Tests

### ✅ Network Security
- [ ] HTTPS enforcement
- [ ] Security headers presence
- [ ] CORS configuration
- [ ] Rate limiting effectiveness

### ✅ Container Security
- [ ] Non-root user execution
- [ ] Minimal attack surface
- [ ] Secret management
- [ ] Resource limits

## Security Headers Validation

### ✅ Required Headers
- [ ] X-Frame-Options: DENY
- [ ] X-Content-Type-Options: nosniff
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Strict-Transport-Security
- [ ] Content-Security-Policy
- [ ] Referrer-Policy

## Automated Security Tests

```bash
# Run security linting
npm audit

# Test for common vulnerabilities
npm install -g snyk
snyk test

# Container security scan
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v $PWD:/root/.cache/ aquasec/trivy:latest image effect-app

# OWASP ZAP security testing
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t http://your-api-url

# SQL injection testing
sqlmap -u "http://localhost:3000/api/endpoint" --batch --banner
```

## Manual Security Testing

### ✅ Authentication Bypass
- [ ] Test with expired tokens
- [ ] Test with malformed tokens
- [ ] Test without tokens
- [ ] Test with tokens from other users

### ✅ Data Exposure
- [ ] Test for sensitive data in responses
- [ ] Check for information disclosure in errors
- [ ] Verify data filtering by user permissions

### ✅ Business Logic
- [ ] Test workflow bypasses
- [ ] Verify state management security
- [ ] Test for race conditions

## Security Monitoring

### ✅ Logging
- [ ] Authentication failures logged
- [ ] Authorization failures logged
- [ ] Sensitive operations audited
- [ ] No sensitive data in logs

### ✅ Alerting
- [ ] Failed login attempts
- [ ] Privilege escalation attempts
- [ ] Unusual access patterns
- [ ] System errors

## Deployment Security

### ✅ Production Hardening
- [ ] Environment variables for secrets
- [ ] Database connection encryption
- [ ] API rate limiting
- [ ] Monitoring and alerting

### ✅ Backup & Recovery
- [ ] Encrypted backups
- [ ] Backup restoration testing
- [ ] Disaster recovery procedures
- [ ] Data retention policies
