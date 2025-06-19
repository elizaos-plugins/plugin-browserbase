import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { retryWithBackoff, Retry, browserRetryConfigs } from '../retry';
import { logger } from '@elizaos/core';

// Mock logger
vi.mock('@elizaos/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('retry utilities', () => {
  let unhandledRejections: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    unhandledRejections = [];
  });

  afterEach(async () => {
    // Clean up any pending timers
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    // Clear any unhandled rejections
    unhandledRejections = [];
  });

  // Suppress unhandled rejection warnings for expected failures
  const originalConsoleError = console.error;
  const unhandledRejectionHandler = (reason: any) => {
    unhandledRejections.push(reason);
  };

  beforeAll(() => {
    process.on('unhandledRejection', unhandledRejectionHandler);
    console.error = (...args: any[]) => {
      if (
        args[0]?.includes &&
        (args[0].includes('PromiseRejectionHandledWarning') ||
          args[0].includes('test operation timed out'))
      ) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterAll(() => {
    process.off('unhandledRejection', unhandledRejectionHandler);
    console.error = originalConsoleError;
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await retryWithBackoff(fn, {}, 'test operation');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('Attempting test operation (attempt 1/3)');
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
        .mockResolvedValueOnce('success');

      const promise = retryWithBackoff(fn, { maxRetries: 3, initialDelay: 100 }, 'test operation');

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalled();

      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(2000); // includes jitter
      expect(fn).toHaveBeenCalledTimes(2);

      const result = await promise;
      expect(result).toBe('success');
    });

    it('should fail after max retries', async () => {
      const error = new Error('ETIMEDOUT');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(fn, { maxRetries: 2, initialDelay: 100 }, 'test operation');

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Second attempt
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Wait for the promise to settle
      await expect(promise).rejects.toThrow('ETIMEDOUT');

      // Verify logging
      expect(logger.error).toHaveBeenCalledWith('test operation failed after 2 attempts');

      // Clean up any remaining timers
      await vi.runAllTimersAsync();
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Invalid credentials');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryWithBackoff(fn, {}, 'test operation')).rejects.toThrow(
        'Invalid credentials'
      );

      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'test operation failed with non-retryable error:',
        error
      );
    });

    it('should handle timeout', async () => {
      const fn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('success'), 2000))
        );

      const promise = retryWithBackoff(fn, { timeout: 1000 }, 'test operation');

      // Advance timers and wait for the promise to reject
      await vi.advanceTimersByTimeAsync(1001);

      // Handle the rejection properly
      await expect(promise).rejects.toThrow('test operation timed out after 1000ms');

      // Ensure the timer callback doesn't execute after the test
      await vi.runAllTimersAsync();
    });

    it('should apply exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce('success');

      const promise = retryWithBackoff(
        fn,
        { maxRetries: 3, initialDelay: 1000, backoffFactor: 2 },
        'test'
      );

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // First retry after ~1000ms (plus jitter)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second retry after ~2000ms (plus jitter)
      await vi.advanceTimersByTimeAsync(3000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe('success');
    });

    it('should respect maxDelay', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce('success');

      const promise = retryWithBackoff(
        fn,
        {
          maxRetries: 2,
          initialDelay: 5000,
          maxDelay: 3000,
          backoffFactor: 2,
        },
        'test'
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Should wait maxDelay (3000) + jitter, not 5000
      await vi.advanceTimersByTimeAsync(4000);
      expect(fn).toHaveBeenCalledTimes(2);

      await promise;
    });
  });

  describe('Retry decorator', () => {
    it('should retry decorated method', async () => {
      const originalFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce('success');

      const descriptor: PropertyDescriptor = {
        value: originalFn,
        writable: true,
        enumerable: false,
        configurable: true,
      };

      const decoratedDescriptor = Retry({ maxRetries: 2, initialDelay: 100 })(
        {},
        'testMethod',
        descriptor
      );

      const promise = decoratedDescriptor.value();

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledTimes(2);
    });

    it('should preserve this context', async () => {
      const testObj = {
        value: 'test',
        async getValue() {
          return this.value;
        },
      };

      const descriptor: PropertyDescriptor = {
        value: testObj.getValue,
        writable: true,
        enumerable: false,
        configurable: true,
      };

      const decoratedDescriptor = Retry({ maxRetries: 1 })(testObj, 'getValue', descriptor);

      const result = await decoratedDescriptor.value.call(testObj);

      expect(result).toBe('test');
    });
  });

  describe('browserRetryConfigs', () => {
    it('should have navigation config', () => {
      const config = browserRetryConfigs.navigation;

      expect(config.maxRetries).toBe(3);
      expect(config.initialDelay).toBe(2000);
      expect(config.maxDelay).toBe(10000);
      expect(config.backoffFactor).toBe(2);
      expect(config.timeout).toBe(30000);
    });

    it('should have action config', () => {
      const config = browserRetryConfigs.action;

      expect(config.maxRetries).toBe(2);
      expect(config.initialDelay).toBe(1000);
      expect(config.maxDelay).toBe(5000);
      expect(config.backoffFactor).toBe(2);
      expect(config.timeout).toBe(15000);
    });

    it('should have extraction config', () => {
      const config = browserRetryConfigs.extraction;

      expect(config.maxRetries).toBe(2);
      expect(config.initialDelay).toBe(500);
      expect(config.maxDelay).toBe(3000);
      expect(config.backoffFactor).toBe(1.5);
      expect(config.timeout).toBe(10000);
    });
  });
});
