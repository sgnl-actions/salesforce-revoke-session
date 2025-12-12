# Salesforce Revoke Session Action

This action revokes all active sessions for a specific user in Salesforce using the Salesforce REST API.

## Overview

The action implements a three-step process to safely revoke all user sessions:

1. **Query User**: Look up the user ID by username using SOQL
2. **Query Sessions**: Find all active sessions for the user
3. **Revoke Sessions**: Delete each session individually, handling cascade deletes

## Prerequisites

- Valid authentication with appropriate permissions:
  - View All Users (`ViewAllUsers`)
  - Manage Auth Providers (`ManageAuthProviders`) or Admin permissions
- Salesforce instance URL

## Configuration

### Authentication

This action supports multiple authentication methods. Configure one of the following:

#### Option 1: Bearer Token
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `BEARER_AUTH_TOKEN` | Secret | Yes | A valid Salesforce OAuth access token |

#### Option 2: Basic Authentication
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `BASIC_USERNAME` | Secret | Yes | Username for basic auth |
| `BASIC_PASSWORD` | Secret | Yes | Password for basic auth |

#### Option 3: OAuth2 Client Credentials
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET` | Secret | Yes | OAuth2 client secret |
| `OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID` | Environment | Yes | OAuth2 client ID |
| `OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL` | Environment | Yes | Token endpoint URL |
| `OAUTH2_CLIENT_CREDENTIALS_SCOPE` | Environment | No | OAuth2 scope |
| `OAUTH2_CLIENT_CREDENTIALS_AUDIENCE` | Environment | No | OAuth2 audience |
| `OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE` | Environment | No | Auth style: `in_header` or `in_body` |

#### Option 4: OAuth2 Authorization Code
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN` | Secret | Yes | OAuth2 access token |

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADDRESS` | Yes | Default Salesforce API base URL | `https://mycompany.salesforce.com` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Salesforce username to revoke sessions for |
| `delay` | Duration | No | Optional delay before revoking sessions |
| `address` | string | No | Salesforce instance URL (overrides `ADDRESS` environment variable) |

### Output Structure

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Operation result (success, failed, etc.) |
| `username` | string | The username that was processed |
| `userId` | string | The Salesforce user ID |
| `sessionsRevoked` | number | Number of sessions that were successfully revoked |
| `processed_at` | datetime | When the operation completed (ISO 8601) |
| `address` | string | The Salesforce API base URL used |

## How It Works

### Step 1: User Lookup
```
GET /services/data/v61.0/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+'{encodedUsername}'+ORDER+BY+Id+ASC
```

Queries the User object to find the user ID for the given username. The username is URL-encoded to handle special characters safely.

### Step 2: Session Query
```
GET /services/data/v61.0/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId='{userId}'+AND+IsCurrent=false+ORDER+BY+Id+ASC
```

Finds all AuthSession records for the user where `IsCurrent=false`, representing sessions that can be deleted.

### Step 3: Session Deletion
```
DELETE /services/data/v61.0/sobjects/AuthSession/{sessionId}
```

Deletes each session individually. Handles both `204 No Content` (successful deletion) and `404 Not Found` (already deleted due to cascade) as success cases.

## Error Handling

The action implements comprehensive error handling:

### Error Behavior
All errors are re-thrown to allow the SGNL framework to handle retry logic based on the configured retry policy.

### Common Errors
- **Authentication failures** (401, 403): Invalid or expired credentials
- **Invalid input**: Missing username parameter
- **Configuration errors**: Missing required environment variables or secrets
- **User not found**: Specified username doesn't exist in Salesforce

### Partial Failures
If some sessions fail to delete, the action logs warnings but continues processing remaining sessions and returns the count of successfully revoked sessions.

## Usage Examples

### Basic Usage
```json
{
  "username": "john.doe@company.com"
}
```

## Security Considerations

- **URL Encoding**: Usernames are properly URL-encoded to prevent SOQL injection
- **Secure Authentication**: Credentials are handled securely through the authentication framework
- **No Credential Logging**: Credentials are never logged in full
- **Least Privilege**: Only queries necessary fields and objects

## Development

### Local Testing

```bash
# Install dependencies
npm install

# Run tests
npm test

# Test with coverage
npm run test:coverage

# Run locally with sample data
npm run dev -- --params '{"username": "test@example.com"}'
```

### Test Coverage

The action includes comprehensive tests covering:
- Three-step process execution
- URL encoding of usernames
- 404 handling as success (cascade deletes)
- Partial failure scenarios
- Input validation
- Error handler behavior
- No sessions found case

## API Rate Limits

Salesforce API calls are subject to rate limits. The SGNL framework handles:
- Retry logic for 429 rate limit responses based on configured retry policy
- Graceful handling of server errors
- Individual session deletion to minimize API call overhead

## Troubleshooting

### Common Issues

**User not found**
- Verify the username exists in Salesforce
- Check that your credentials have permission to query User records

**Authentication errors**
- Verify your credentials are valid and not expired
- Ensure you have appropriate permissions
- Check that `ADDRESS` environment variable is correct
- Ensure you have configured one of the supported authentication methods

**No authentication configured**
- Verify you have configured one of the supported authentication methods
- Check that credentials are properly set in secrets and environment variables

**No sessions to revoke**
- This is normal - user may not have any active sessions
- Only non-current sessions (`IsCurrent=false`) are targeted for deletion

**Partial session deletion**
- Some sessions may fail to delete due to timing or dependencies
- The action continues processing and reports the count of successful deletions
- Check logs for specific session deletion errors

### Debugging

Enable detailed logging by checking console output:
- Step-by-step progress messages
- API response details
- Session deletion results
- Error details and retry attempts

## Salesforce Permissions

Your credentials must have permissions for:
- Querying User records
- Querying AuthSession records
- Deleting AuthSession records

This typically requires:
- `View All Users` permission
- Admin-level access or `Manage Auth Providers`

## Related Documentation

- [Salesforce REST API Reference](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/)
- [SOQL and SOSL Reference](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/)
- [OAuth 2.0 Web Server Flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm)