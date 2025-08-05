# Aurora PostgreSQL Migration Guide

## Overview

This guide documents the successful migration from SQLite to Aurora PostgreSQL for the Effect-TS application, including infrastructure setup, auto-switching database configuration, and deployment procedures.

## Architecture

### Database Auto-Switching Logic

The application automatically chooses between SQLite and PostgreSQL based on environment variables:

- **SQLite (Default)**: Used for local development
- **PostgreSQL**: Used when any of these conditions are met:
  - `DATABASE_HOST` is set
  - `DATABASE_URL` is set  
  - `NODE_ENV=production`

### Key Files

- `src/Sql.ts` - Original SQLite configuration
- `src/SqlPostgres.ts` - PostgreSQL configuration with environment variables
- `src/SqlAuto.ts` - Auto-switching logic between databases
- `lib/effect-app-stack.ts` - Aurora PostgreSQL CDK infrastructure

## Infrastructure Components

### Aurora PostgreSQL Cluster

```typescript
// Aurora PostgreSQL with T3.medium instances
const auroraCluster = new rds.DatabaseCluster(this, 'AuroraPostgresCluster', {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_15_4,
  }),
  credentials: rds.Credentials.fromGeneratedSecret('postgres'),
  instanceProps: {
    vpc,
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    securityGroups: [dbSecurityGroup],
  },
  defaultDatabaseName: 'effect_app',
  storageEncrypted: true,
  backup: { retention: cdk.Duration.days(7) },
});
```

### Security Configuration

- **Database Subnet**: Isolated private subnets for Aurora cluster
- **Security Groups**: Restrictive ingress rules allowing only ECS service access
- **Secrets Manager**: Automatically generated and rotated database credentials
- **Encryption**: Storage encryption enabled for data at rest

### ECS Integration

The ECS task definition automatically receives:

**Environment Variables:**
- `DATABASE_HOST` - Aurora cluster endpoint
- `DATABASE_PORT` - PostgreSQL port (5432)
- `DATABASE_NAME` - Database name (effect_app)
- `DATABASE_SSL` - SSL enabled (true)
- `DATABASE_MAX_CONNECTIONS` - Connection pool size (10)

**Secrets from AWS Secrets Manager:**
- `DATABASE_USERNAME` - Master username
- `DATABASE_PASSWORD` - Master password

## Environment Variables Reference

### PostgreSQL Configuration

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DATABASE_HOST` | PostgreSQL host | localhost | `aurora-cluster.xyz.rds.amazonaws.com` |
| `DATABASE_PORT` | PostgreSQL port | 5432 | `5432` |
| `DATABASE_NAME` | Database name | effect_app | `effect_app` |
| `DATABASE_USERNAME` | Username | postgres | `postgres` |
| `DATABASE_PASSWORD` | Password | (empty) | `secure_password` |
| `DATABASE_SSL` | Enable SSL | false | `true` |
| `DATABASE_MAX_CONNECTIONS` | Max connections | 10 | `20` |

### Auto-Switching Triggers

| Variable | Effect |
|----------|---------|
| `DATABASE_HOST=<value>` | Switches to PostgreSQL |
| `DATABASE_URL=<value>` | Switches to PostgreSQL |
| `NODE_ENV=production` | Switches to PostgreSQL |

## Deployment Procedures

### 1. Deploy Infrastructure

```bash
# Deploy Aurora PostgreSQL infrastructure
npx cdk deploy --app "npx ts-node bin/effect-app.ts"
```

### 2. Retrieve Database Credentials

```bash
# Get cluster endpoint
aws rds describe-db-clusters --db-cluster-identifier <cluster-id> \
  --query 'DBClusters[0].Endpoint' --output text

# Get credentials from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id effect-app/aurora-postgres-credentials \
  --query 'SecretString' --output text
```

### 3. Run Database Migrations

```bash
# Set environment variables for PostgreSQL
export DATABASE_HOST=<aurora-endpoint>
export DATABASE_USERNAME=<username>
export DATABASE_PASSWORD=<password>

# Run migrations (auto-detected PostgreSQL)
npm run migrate
```

### 4. Deploy Application

```bash
# Build and push Docker image
docker build -t effect-app .
docker tag effect-app:latest <ecr-uri>:latest
docker push <ecr-uri>:latest

# Update ECS service
aws ecs update-service --cluster effect-app-cluster \
  --service effect-app-service --force-new-deployment
```

## Testing Procedures

### Local Development Testing

```bash
# Test SQLite (default)
npm run dev
# Expected: "🗃️ Using SQLite database configuration"

# Test PostgreSQL switching
DATABASE_HOST=localhost npm run dev
# Expected: "🐘 Using PostgreSQL database configuration"

# Test production mode
NODE_ENV=production npm run dev
# Expected: "🐘 Using PostgreSQL database configuration"
```

### Unit Tests

```bash
# All tests should pass with any database configuration
npm run test:unit
# Expected: All 26 tests passing
```

### Integration Tests

```bash
# Test with actual PostgreSQL connection
export DATABASE_HOST=<aurora-endpoint>
export DATABASE_USERNAME=<username>
export DATABASE_PASSWORD=<password>
npm run test:integration
```

## Migration Verification

### 1. Database Schema Validation

```sql
-- Verify tables exist in Aurora
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';
-- Expected: users, accounts, groups, people
```

### 2. Data Migration Verification

```sql
-- Check data consistency
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM accounts;
SELECT COUNT(*) FROM groups;
SELECT COUNT(*) FROM people;
```

### 3. Application Health Checks

```bash
# Health endpoint
curl https://<api-gateway-url>/health
# Expected: {"status":"healthy"}

# API functionality
curl https://<api-gateway-url>/accounts
# Expected: Valid JSON response
```

## Monitoring and Alerts

### CloudWatch Metrics

- **Database Connections**: Monitor connection pool usage
- **Database CPU**: Track Aurora cluster performance
- **Query Performance**: Monitor slow queries
- **Error Rates**: Track database connection failures

### Key Alarms

- High database CPU utilization (>80%)
- High connection count (>80% of max)
- Database connection failures
- Long-running queries (>30 seconds)

## Rollback Procedures

### Emergency Rollback to SQLite

1. **Update Environment Variables:**
   ```bash
   # Remove PostgreSQL environment variables
   unset DATABASE_HOST
   unset DATABASE_URL
   # Or set NODE_ENV to development
   export NODE_ENV=development
   ```

2. **Redeploy Application:**
   ```bash
   aws ecs update-service --cluster effect-app-cluster \
     --service effect-app-service --force-new-deployment
   ```

3. **Verify Rollback:**
   ```bash
   # Check logs for SQLite usage
   aws logs tail /ecs/effect-app --follow
   # Expected: "🗃️ Using SQLite database configuration"
   ```

### Data Recovery

If data needs to be restored from Aurora to SQLite:

1. **Export Data from Aurora:**
   ```bash
   pg_dump -h <aurora-endpoint> -U <username> -d effect_app > backup.sql
   ```

2. **Import to SQLite:**
   ```bash
   # Convert PostgreSQL dump to SQLite format
   sqlite3 data/db.sqlite < converted_backup.sql
   ```

## Security Considerations

### Network Security

- Aurora cluster isolated in private subnets
- Security groups restrict access to ECS service only
- No direct internet access to database

### Credential Management

- Database credentials stored in AWS Secrets Manager
- Automatic credential rotation enabled
- ECS tasks retrieve credentials at runtime
- No hardcoded credentials in application code

### Encryption

- **At Rest**: Aurora storage encryption enabled
- **In Transit**: SSL/TLS connections enforced
- **Secrets**: Encrypted with AWS KMS

## Performance Optimization

### Connection Pooling

```typescript
// PostgreSQL connection pool configuration
const PgClientLive = PgClient.layer({
  maxConnections: 10,        // Adjust based on load
  connectionTimeout: 30000,  // 30 seconds
  idleTimeout: 300000,      // 5 minutes
});
```

### Aurora Scaling

- **Serverless v2**: Auto-scales based on demand
- **Read Replicas**: Can be added for read scaling
- **Performance Insights**: Monitor query performance

## Troubleshooting

### Common Issues

1. **Connection Timeout**
   ```
   Error: connect ETIMEDOUT
   ```
   - Check security groups
   - Verify Aurora endpoint
   - Confirm VPC connectivity

2. **Authentication Failed**
   ```
   Error: password authentication failed
   ```
   - Verify Secrets Manager credentials
   - Check ECS task execution role permissions
   - Confirm database user exists

3. **SSL Connection Issues**
   ```
   Error: SSL SYSCALL error
   ```
   - Verify SSL configuration
   - Check certificate validity
   - Confirm SSL enforcement settings

### Debug Commands

```bash
# Check Aurora cluster status
aws rds describe-db-clusters --db-cluster-identifier <cluster-id>

# View ECS task logs
aws logs tail /ecs/effect-app --follow --region us-west-2

# Test database connectivity
psql -h <aurora-endpoint> -U <username> -d effect_app -c "SELECT version();"
```

## Cost Optimization

### Aurora Serverless v2

- **Benefits**: Pay only for compute used
- **Scaling**: 0.5 to 1 ACU range for development
- **Pausing**: Automatically pauses when inactive

### Development Environment

- **Instance Type**: T3.medium for cost-effective development
- **Backup Retention**: 7 days (minimum)
- **Multi-AZ**: Disabled for development (enable for production)

## Next Steps

1. **Performance Testing**: Load test with Aurora PostgreSQL
2. **Monitoring Setup**: Configure comprehensive CloudWatch dashboards
3. **Backup Strategy**: Implement automated backup verification
4. **Disaster Recovery**: Set up cross-region replication
5. **Security Audit**: Regular security assessments and penetration testing

## Support Contacts

- **Infrastructure**: AWS Support
- **Database**: Aurora PostgreSQL documentation
- **Application**: Effect-TS community and documentation

---

*Last Updated: August 4, 2025*
*Version: 1.0*
