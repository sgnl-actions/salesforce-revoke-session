// SGNL Job Script - Auto-generated bundle
'use strict';

/**
 * Salesforce Revoke Session Action
 *
 * This action revokes all active sessions for a specific user in Salesforce
 * using a three-step process:
 * 1. Query for user ID by username
 * 2. Query for all user's auth sessions
 * 3. Delete each session individually
 */

/**
 * Helper function to make Salesforce API calls
 * @param {string} endpoint - API endpoint path
 * @param {string} method - HTTP method
 * @param {string} instanceUrl - Salesforce instance URL
 * @param {string} accessToken - OAuth access token
 * @returns {Response} Fetch response
 */
async function callSalesforceAPI(endpoint, method, instanceUrl, accessToken) {
  const url = new URL(endpoint, instanceUrl);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  return response;
}

var script = {
  /**
   * Main execution handler - revokes all sessions for a user
   * @param {Object} params - Job input parameters
   * @param {string} params.username - Salesforce username
   * @param {string} [params.apiVersion="v61.0"] - API version to use
   * @param {Object} context - Execution context with env, secrets, outputs
   * @returns {Object} Job results
   */
  invoke: async (params, context) => {
    console.log('Starting Salesforce session revocation');

    // Validate inputs
    if (!params.username) {
      throw new Error('username is required');
    }

    const { username, apiVersion = 'v61.0' } = params;
    const { SALESFORCE_ACCESS_TOKEN } = context.secrets;
    const { SALESFORCE_INSTANCE_URL } = context.environment;

    if (!SALESFORCE_ACCESS_TOKEN) {
      throw new Error('SALESFORCE_ACCESS_TOKEN secret is required');
    }

    if (!SALESFORCE_INSTANCE_URL) {
      throw new Error('SALESFORCE_INSTANCE_URL environment variable is required');
    }

    console.log(`Processing username: ${username}`);
    console.log(`Using API version: ${apiVersion}`);

    try {
      // Step 1: Query for user ID by username
      const encodedUsername = encodeURIComponent(username);
      const userQueryEndpoint = `/services/data/${apiVersion}/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+'${encodedUsername}'+ORDER+BY+Id+ASC`;

      console.log('Step 1: Querying for user ID...');
      const userResponse = await callSalesforceAPI(userQueryEndpoint, 'GET', SALESFORCE_INSTANCE_URL, SALESFORCE_ACCESS_TOKEN);

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
      const sessionQueryEndpoint = `/services/data/${apiVersion}/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId='${userId}'+AND+IsCurrent=false+ORDER+BY+Id+ASC`;

      console.log('Step 2: Querying for user sessions...');
      const sessionResponse = await callSalesforceAPI(sessionQueryEndpoint, 'GET', SALESFORCE_INSTANCE_URL, SALESFORCE_ACCESS_TOKEN);

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
          processed_at: new Date().toISOString()
        };
      }

      // Step 3: Delete each session individually
      console.log('Step 3: Revoking sessions...');
      let sessionsRevoked = 0;

      for (const session of sessions) {
        const deleteEndpoint = `/services/data/${apiVersion}/sobjects/AuthSession/${session.Id}`;

        try {
          const deleteResponse = await callSalesforceAPI(deleteEndpoint, 'DELETE', SALESFORCE_INSTANCE_URL, SALESFORCE_ACCESS_TOKEN);

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
        processed_at: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Failed to revoke sessions for user ${username}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Error recovery handler - implements retry logic for transient failures
   * @param {Object} params - Original params plus error information
   * @param {Object} context - Execution context
   * @returns {Object} Recovery results or throws for fatal errors
   */
  error: async (params, _context) => {
    const { error, username } = params;
    console.error(`Session revocation encountered error for user ${username}: ${error.message}`);

    // Check for retryable errors (rate limits, server errors)
    if (error.message.includes('429') ||
        error.message.includes('502') ||
        error.message.includes('503') ||
        error.message.includes('504')) {

      console.log('Detected retryable error, waiting before retry...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Let the system handle the retry instead
      return { status: 'retry_requested' };
    }

    // Fatal errors - don't retry
    if (error.message.includes('401') ||
        error.message.includes('403') ||
        error.message.includes('User not found') ||
        error.message.includes('username is required') ||
        error.message.includes('SALESFORCE_ACCESS_TOKEN') ||
        error.message.includes('SALESFORCE_INSTANCE_URL')) {
      throw error;
    }

    // Default: let framework retry
    return { status: 'retry_requested' };
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

module.exports = script;
