import { jest } from '@jest/globals';
import script from '../src/script.mjs';
import { SGNL_USER_AGENT } from '@sgnl-actions/utils';

// Mock fetch globally
global.fetch = jest.fn();

describe('Salesforce Revoke Session Script', () => {
  const mockContext = {
    environment: {
      ADDRESS: 'https://mycompany.salesforce.com'
    },
    secrets: {
      BEARER_AUTH_TOKEN: 'test-access-token-123456'
    }
  };

  beforeEach(() => {
    fetch.mockClear();
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  describe('invoke handler', () => {
    test('should successfully revoke sessions with three-step process', async () => {
      const params = {
        username: 'test.user@example.com'
      };

      // Step 1: User query response
      const userQueryResponse = {
        ok: true,
        json: async () => ({
          records: [{ Id: 'user123' }]
        })
      };

      // Step 2: Session query response
      const sessionQueryResponse = {
        ok: true,
        json: async () => ({
          records: [
            { Id: 'session1', UsersId: 'user123' },
            { Id: 'session2', UsersId: 'user123' }
          ]
        })
      };

      // Step 3: Delete responses (204 No Content)
      const deleteResponse1 = { ok: true, status: 204 };
      const deleteResponse2 = { ok: true, status: 204 };

      fetch
        .mockResolvedValueOnce(userQueryResponse)
        .mockResolvedValueOnce(sessionQueryResponse)
        .mockResolvedValueOnce(deleteResponse1)
        .mockResolvedValueOnce(deleteResponse2);

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.username).toBe('test.user@example.com');
      expect(result.userId).toBe('user123');
      expect(result.sessionsRevoked).toBe(2);
      expect(result.processed_at).toBeDefined();

      // Verify API calls
      expect(fetch).toHaveBeenCalledTimes(4);

      // Step 1: User query
      expect(fetch).toHaveBeenNthCalledWith(1,
        "https://mycompany.salesforce.com/services/data/v61.0/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+'test.user%40example.com'+ORDER+BY+Id+ASC",
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456',
            'User-Agent': SGNL_USER_AGENT
          })
        })
      );

      // Step 2: Session query
      expect(fetch).toHaveBeenNthCalledWith(2,
        "https://mycompany.salesforce.com/services/data/v61.0/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId='user123'+AND+IsCurrent=false+ORDER+BY+Id+ASC",
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456',
            'User-Agent': SGNL_USER_AGENT
          })
        })
      );

      // Step 3: Delete requests
      expect(fetch).toHaveBeenNthCalledWith(3,
        'https://mycompany.salesforce.com/services/data/v61.0/sobjects/AuthSession/session1',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456',
            'User-Agent': SGNL_USER_AGENT
          })
        })
      );
    });

    test('should handle URL encoding in username', async () => {
      const params = {
        username: 'test+user@example.com'
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'user123' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [] })
        });

      await script.invoke(params, mockContext);

      // Verify URL encoding
      expect(fetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('test%2Buser%40example.com'),
        expect.any(Object)
      );
    });

    test('should handle no sessions found case', async () => {
      const params = {
        username: 'test.user@example.com'
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'user123' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [] })
        });

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.username).toBe('test.user@example.com');
      expect(result.userId).toBe('user123');
      expect(result.sessionsRevoked).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(2); // Only user and session queries, no deletes
    });

    test('should handle 404 responses as success (cascade deletes)', async () => {
      const params = {
        username: 'test.user@example.com'
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'user123' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'session1', UsersId: 'user123' }] })
        })
        .mockResolvedValueOnce({ ok: false, status: 404 }); // 404 treated as success

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.sessionsRevoked).toBe(1);
    });

    test('should handle partial session deletion failures gracefully', async () => {
      const params = {
        username: 'test.user@example.com'
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'user123' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            records: [
              { Id: 'session1', UsersId: 'user123' },
              { Id: 'session2', UsersId: 'user123' }
            ]
          })
        })
        .mockResolvedValueOnce({ ok: true, status: 204 }) // Success
        .mockResolvedValueOnce({ ok: false, status: 500 }); // Failure

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.sessionsRevoked).toBe(1); // Only one succeeded
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to revoke session session2')
      );
    });


    test('should validate required secrets', async () => {
      const params = { username: 'test@example.com' };
      const contextMissingSecret = {
        ...mockContext,
        secrets: {}
      };

      await expect(script.invoke(params, contextMissingSecret))
        .rejects.toThrow('No authentication configured');
    });

    test('should validate required environment variables', async () => {
      const params = { username: 'test@example.com' };
      const contextMissingEnv = {
        ...mockContext,
        environment: {}
      };

      await expect(script.invoke(params, contextMissingEnv))
        .rejects.toThrow('No URL specified. Provide address parameter or ADDRESS environment variable');
    });

    test('should handle user not found error', async () => {
      const params = {
        username: 'nonexistent@example.com'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ records: [] })
      });

      await expect(script.invoke(params, mockContext))
        .rejects.toThrow('User not found: nonexistent@example.com');
    });

    test('should handle API errors during user query', async () => {
      const params = {
        username: 'test@example.com'
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(script.invoke(params, mockContext))
        .rejects.toThrow('Failed to query user: 500 Internal Server Error');
    });

    test('should handle API errors during session query', async () => {
      const params = {
        username: 'test@example.com'
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ records: [{ Id: 'user123' }] })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden'
        });

      await expect(script.invoke(params, mockContext))
        .rejects.toThrow('Failed to query sessions: 403 Forbidden');
    });
  });

  describe('error handler', () => {
    test('should rethrow errors', async () => {
      const testError = new Error('Some error occurred');
      const params = {
        username: 'test@example.com',
        error: testError
      };

      await expect(script.error(params, mockContext))
        .rejects.toThrow('Some error occurred');
    });
  });

  describe('halt handler', () => {
    test('should handle graceful shutdown with username', async () => {
      const params = {
        username: 'test@example.com',
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.username).toBe('test@example.com');
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without username', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.username).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});