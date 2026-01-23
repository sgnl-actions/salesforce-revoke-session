/**
 * Salesforce Revoke Session Action
 *
 * This action revokes all active sessions for a specific user in Salesforce
 * using a three-step process:
 * 1. Query for user ID by username
 * 2. Query for all user's auth sessions
 * 3. Delete each session individually
 */

import { getBaseURL, getAuthorizationHeader} from '@sgnl-actions/utils';

/**
 * Helper function to make Salesforce API calls
 * @param {string} endpoint - API endpoint path
 * @param {string} method - HTTP method
 * @param {string} baseUrl - Salesforce instance URL
 * @param {string} authHeader - Authorization header (already formatted)
 * @returns {Response} Fetch response
 */
async function callSalesforceAPI(endpoint, method, baseUrl, authHeader) {
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  return response;
}

export default {
  /**
   * Main execution handler - revokes all sessions for a user
   * @param {Object} params - Job input parameters
   * @param {string} params.username - Salesforce username
   * @param {string} params.delay - Optional delay before revoking sessions
   * @param {string} params.address - Optional Salesforce API base URL
   * @param {Object} context - Execution context with secrets and environment
   * @param {string} context.environment.ADDRESS - Default Salesforce API base URL
   *
   * The configured auth type will determine which of the following environment variables and secrets are available
   * @param {string} context.secrets.BEARER_AUTH_TOKEN
   *
   * @param {string} context.secrets.BASIC_USERNAME
   * @param {string} context.secrets.BASIC_PASSWORD
   *
   * @param {string} context.secrets.OAUTH2_CLIENT_CREDENTIALS_CLIENT_SECRET
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_AUDIENCE
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_AUTH_STYLE
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_CLIENT_ID
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_SCOPE
   * @param {string} context.environment.OAUTH2_CLIENT_CREDENTIALS_TOKEN_URL
   *
   * @param {string} context.secrets.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN
   *
   * @returns {Promise<Object>} Action result
   */
  invoke: async (params, context) => {
    console.log('Starting Salesforce session revocation');

    const { username } = params;

    // Get base URL using utility function
    const baseUrl = getBaseURL(params, context);

    // Get authorization header using utility function
    const authHeader = await getAuthorizationHeader(context);

    console.log(`Processing username: ${username}`);

    try {
      // Step 1: Query for user ID by username
      const encodedUsername = encodeURIComponent(username);
      const userQueryEndpoint = `/services/data/v61.0/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+'${encodedUsername}'+ORDER+BY+Id+ASC`;

      console.log('Step 1: Querying for user ID...');
      const userResponse = await callSalesforceAPI(userQueryEndpoint, 'GET', baseUrl, authHeader);

      if (!userResponse.ok) {
        throw new Error(`Failed to query user: ${userResponse.status} ${userResponse.statusText}`);
      }

      const userData = await userResponse.json();

      if (!userData.records || userData.records.length === 0) {
        throw new Error(`User not found: ${username}`);
      }

      const userId = userData.records[0].Id;
      console.log(`Found user ID: ${userId}`);

      // Step 2: Query for all user's auth sessions
      const sessionQueryEndpoint = `/services/data/v61.0/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId='${userId}'+AND+IsCurrent=false+ORDER+BY+Id+ASC`;

      console.log('Step 2: Querying for user sessions...');
      const sessionResponse = await callSalesforceAPI(sessionQueryEndpoint, 'GET', baseUrl, authHeader);

      if (!sessionResponse.ok) {
        throw new Error(`Failed to query sessions: ${sessionResponse.status} ${sessionResponse.statusText}`);
      }

      const sessionData = await sessionResponse.json();
      const sessions = sessionData.records || [];

      console.log(`Found ${sessions.length} sessions to revoke`);

      if (sessions.length === 0) {
        console.log('No sessions found to revoke');
        return {
          status: 'success',
          username,
          userId,
          sessionsRevoked: 0,
          processed_at: new Date().toISOString(),
          address: baseUrl
        };
      }

      // Step 3: Delete each session individually
      console.log('Step 3: Revoking sessions...');
      let sessionsRevoked = 0;

      for (const session of sessions) {
        const deleteEndpoint = `/services/data/v61.0/sobjects/AuthSession/${session.Id}`;

        try {
          const deleteResponse = await callSalesforceAPI(deleteEndpoint, 'DELETE', baseUrl, authHeader);

          // Handle 204 No Content as success, and 404 as success (cascade deletes)
          if (deleteResponse.status === 204 || deleteResponse.status === 404) {
            sessionsRevoked++;
            console.log(`Successfully revoked session: ${session.Id}`);
          } else if (!deleteResponse.ok) {
            console.warn(`Failed to revoke session ${session.Id}: ${deleteResponse.status} ${deleteResponse.statusText}`);
          } else {
            sessionsRevoked++;
            console.log(`Successfully revoked session: ${session.Id}`);
          }
        } catch (sessionError) {
          console.warn(`Error revoking session ${session.Id}: ${sessionError.message}`);
        }
      }

      console.log(`Successfully revoked ${sessionsRevoked} out of ${sessions.length} sessions`);

      return {
        status: 'success',
        username,
        userId,
        sessionsRevoked,
        processed_at: new Date().toISOString(),
        address: baseUrl
      };

    } catch (error) {
      console.error(`Failed to revoke sessions for user ${username}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Error recovery handler - re-throws errors to let framework handle retry logic
   * @param {Object} params - Original params plus error information
   * @param {Object} context - Execution context
   * @returns {Object} Recovery results or throws for fatal errors
   */
  error: async (params, _context) => {
    const { error } = params;
    throw error;
  },

  /**
   * Graceful shutdown handler - implements cleanup logic
   * @param {Object} params - Original params plus halt reason
   * @param {Object} context - Execution context
   * @returns {Object} Cleanup results
   */
  halt: async (params, _context) => {
    const { reason, username } = params;
    console.log(`Session revocation is being halted (${reason}) for user: ${username}`);

    // Log current state for debugging
    console.log('Halting session revocation process - no cleanup needed');

    return {
      status: 'halted',
      username: username || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};