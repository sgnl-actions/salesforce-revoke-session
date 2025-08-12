# Salesforce Revoke Session Action

This action revokes all active sessions for a specific user in Salesforce using the Salesforce REST API.

## Overview

The action implements a three-step process to safely revoke all user sessions:

1. **Query User**: Look up the user ID by username using SOQL
2. **Query Sessions**: Find all active sessions for the user
3. **Revoke Sessions**: Delete each session individually, handling cascade deletes

## Prerequisites

- Salesforce access token with appropriate permissions:
  - View All Users (`ViewAllUsers`)
  - Manage Auth Providers (`ManageAuthProviders`) or Admin permissions
- Salesforce instance URL

## Configuration

### Required Secrets

- `SALESFORCE_ACCESS_TOKEN`: OAuth access token for Salesforce API authentication

### Required Environment Variables

- `SALESFORCE_INSTANCE_URL`: Salesforce instance URL (e.g., `https://mycompany.salesforce.com`)

### Input Parameters

- `username` (string, required): Salesforce username to revoke sessions for
- `apiVersion` (string, optional): Salesforce API version to use (defaults to `"v61.0"`)

### Output

- `status`: Operation result (`success`, `failed`, etc.)
- `username`: The username that was processed
- `userId`: The Salesforce user ID
- `sessionsRevoked`: Number of sessions that were successfully revoked
- `processed_at`: When the operation completed (ISO 8601)

## How It Works

### Step 1: User Lookup
```
GET /services/data/{apiVersion}/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+'{encodedUsername}'+ORDER+BY+Id+ASC
```

Queries the User object to find the user ID for the given username. The username is URL-encoded to handle special characters safely.

### Step 2: Session Query
```
GET /services/data/{apiVersion}/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId='{userId}'+AND+IsCurrent=false+ORDER+BY+Id+ASC
```

Finds all AuthSession records for the user where `IsCurrent=false`, representing sessions that can be deleted.

### Step 3: Session Deletion
```
DELETE /services/data/{apiVersion}/sobjects/AuthSession/{sessionId}
```

Deletes each session individually. Handles both `204 No Content` (successful deletion) and `404 Not Found` (already deleted due to cascade) as success cases.

## Error Handling

The action implements comprehensive error handling:

### Retryable Errors (with backoff)
- Rate limiting (429)
- Server errors (502, 503, 504)

### Fatal Errors (no retry)
- Authentication failures (401, 403)
- Invalid input (missing username)
- Configuration errors (missing secrets/environment)
- User not found

### Partial Failures
If some sessions fail to delete, the action logs warnings but continues processing remaining sessions and returns the count of successfully revoked sessions.

## Usage Examples

### Basic Usage
```json
{
  "username": "john.doe@company.com"
}
```

### With Custom API Version
```json
{
  "username": "admin@company.com",
  "apiVersion": "v60.0"
}
```

## Security Considerations

- **URL Encoding**: Usernames are properly URL-encoded to prevent SOQL injection
- **Bearer Authentication**: Uses standard OAuth Bearer token authentication
- **No Credential Logging**: Access tokens are never logged in full
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
- Error handling and retry logic
- No sessions found case

## API Rate Limits

Salesforce API calls are subject to rate limits. The action implements:
- Exponential backoff for 429 rate limit responses
- Graceful handling of server errors
- Individual session deletion to minimize API call overhead

## Troubleshooting

### Common Issues

**User not found**
- Verify the username exists in Salesforce
- Check that the access token has permission to query User records

**Authentication errors**
- Verify `SALESFORCE_ACCESS_TOKEN` is valid and not expired
- Ensure the token has appropriate permissions
- Check `SALESFORCE_INSTANCE_URL` is correct

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

The access token must have permissions for:
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