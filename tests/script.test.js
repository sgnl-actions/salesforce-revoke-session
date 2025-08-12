import { jest } from '@jest/globals';
import script from '../src/script.mjs';

// Mock fetch globally
global.fetch = jest.fn();

describe('Salesforce Revoke Session Script', () => {
  const mockContext = {
    environment: {
      SALESFORCE_INSTANCE_URL: 'https://mycompany.salesforce.com'
    },
    secrets: {
      SALESFORCE_ACCESS_TOKEN: 'test-access-token-123456'
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
        username: 'test.user@example.com',
        apiVersion: 'v61.0'
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
        'https://mycompany.salesforce.com/services/data/v61.0/query?q=SELECT+Id+FROM+User+WHERE+username+LIKE+%27test.user%40example.com%27+ORDER+BY+Id+ASC',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456'
          })
        })
      );

      // Step 2: Session query
      expect(fetch).toHaveBeenNthCalledWith(2,
        'https://mycompany.salesforce.com/services/data/v61.0/query?q=SELECT+Id,UsersId+FROM+AuthSession+WHERE+UsersId=%27user123%27+AND+IsCurrent=false+ORDER+BY+Id+ASC',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456'
          })
        })
      );

      // Step 3: Delete requests
      expect(fetch).toHaveBeenNthCalledWith(3,
        'https://mycompany.salesforce.com/services/data/v61.0/sobjects/AuthSession/session1',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token-123456'
          })
        })
      );
    });

    test('should handle default API version', async () => {
      const params = {
        username: 'test.user@example.com'
      };

      // Mock responses for default v61.0
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
      expect(result.sessionsRevoked).toBe(0);

      // Verify default API version is used
      expect(fetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('/services/data/v61.0/query'),
        expect.any(Object)
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

    test('should validate required inputs', async () => {
      const params = {};

      await expect(script.invoke(params, mockContext)).rejects.toThrow('username is required');
    });

    test('should validate required secrets', async () => {
      const params = { username: 'test@example.com' };
      const contextMissingSecret = {
        ...mockContext,
        secrets: {}
      };

      await expect(script.invoke(params, contextMissingSecret))
        .rejects.toThrow('SALESFORCE_ACCESS_TOKEN secret is required');
    });

    test('should validate required environment variables', async () => {
      const params = { username: 'test@example.com' };
      const contextMissingEnv = {
        ...mockContext,
        environment: {}
      };

      await expect(script.invoke(params, contextMissingEnv))
        .rejects.toThrow('SALESFORCE_INSTANCE_URL environment variable is required');
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
    // Mock setTimeout to avoid actual delays
    beforeEach(() => {
      jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 123; // Mock timer ID
      });
    });

    afterEach(() => {
      if (global.setTimeout.mockRestore) {
        global.setTimeout.mockRestore();
      }
    });

    test('should retry on rate limit errors (429)', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'Rate limited: 429' }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
    });

    test('should retry on server errors (502, 503, 504)', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'Server error: 503 Service Unavailable' }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
    });

    test('should not retry on authentication errors (401, 403)', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'Authentication failed: 401' }
      };

      try {
        await script.error(params, mockContext);
        throw new Error('Expected error to be thrown');
      } catch (error) {
        expect(error.message).toBe('Authentication failed: 401');
      }
    });

    test('should not retry on validation errors', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'username is required' }
      };

      try {
        await script.error(params, mockContext);
        throw new Error('Expected error to be thrown');
      } catch (error) {
        expect(error.message).toBe('username is required');
      }
    });

    test('should not retry on user not found errors', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'User not found: test@example.com' }
      };

      try {
        await script.error(params, mockContext);
        throw new Error('Expected error to be thrown');
      } catch (error) {
        expect(error.message).toBe('User not found: test@example.com');
      }
    });

    test('should request retry for unknown errors', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'Unknown network error' }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
    });

    test('should wait before requesting retry for rate limits', async () => {
      const params = {
        username: 'test@example.com',
        error: { message: 'Rate limited: 429' }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('retry_requested');
      expect(global.setTimeout).toHaveBeenCalled();
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