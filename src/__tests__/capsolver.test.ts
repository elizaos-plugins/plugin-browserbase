import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CapSolverService, detectCaptchaType, injectCaptchaSolution } from '../capsolver';
import { logger } from '@elizaos/core';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock logger
vi.mock('@elizaos/core', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CapSolverService', () => {
  let capSolver: CapSolverService;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
    capSolver = new CapSolverService({ apiKey: mockApiKey });
  });

  describe('createTask', () => {
    it('should create a task successfully', async () => {
      const mockTaskId = 'task-123';
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          errorId: 0,
          taskId: mockTaskId,
        },
      });

      const task = {
        type: 'AntiTurnstileTaskProxyLess',
        websiteURL: 'https://example.com',
        websiteKey: 'test-key',
      };

      const taskId = await capSolver.createTask(task);

      expect(taskId).toBe(mockTaskId);
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.capsolver.com/createTask',
        {
          clientKey: mockApiKey,
          task,
        },
        expect.any(Object)
      );
    });

    it('should throw error when API returns error', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          errorId: 1,
          errorDescription: 'Invalid API key',
        },
      });

      const task = {
        type: 'AntiTurnstileTaskProxyLess',
        websiteURL: 'https://example.com',
        websiteKey: 'test-key',
      };

      await expect(capSolver.createTask(task)).rejects.toThrow('CapSolver error: Invalid API key');
    });
  });

  describe('getTaskResult', () => {
    it('should return solution when task is ready', async () => {
      const mockSolution = { token: 'solved-token' };
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          errorId: 0,
          status: 'ready',
          solution: mockSolution,
        },
      });

      const result = await capSolver.getTaskResult('task-123');

      expect(result).toEqual(mockSolution);
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.capsolver.com/getTaskResult',
        {
          clientKey: mockApiKey,
          taskId: 'task-123',
        },
        expect.any(Object)
      );
    });

    it('should poll until task is ready', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: {
            errorId: 0,
            status: 'processing',
          },
        })
        .mockResolvedValueOnce({
          data: {
            errorId: 0,
            status: 'ready',
            solution: { token: 'solved-token' },
          },
        });

      // Reduce polling interval for testing
      const fastCapSolver = new CapSolverService({ 
        apiKey: mockApiKey,
        pollingInterval: 10, // 10ms for testing
      });

      const result = await fastCapSolver.getTaskResult('task-123');

      expect(result).toEqual({ token: 'solved-token' });
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should throw error on timeout', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          errorId: 0,
          status: 'processing',
        },
      });

      const fastCapSolver = new CapSolverService({ 
        apiKey: mockApiKey,
        pollingInterval: 10,
        retryAttempts: 2,
      });

      await expect(fastCapSolver.getTaskResult('task-123')).rejects.toThrow('CapSolver task timeout');
    });
  });

  describe('solveTurnstile', () => {
    it('should solve Turnstile captcha', async () => {
      const mockTaskId = 'task-123';
      const mockToken = 'turnstile-token';

      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: { errorId: 0, taskId: mockTaskId },
        })
        .mockResolvedValueOnce({
          data: { errorId: 0, status: 'ready', solution: { token: mockToken } },
        });

      const token = await capSolver.solveTurnstile('https://example.com', 'site-key');

      expect(token).toBe(mockToken);
      expect(logger.info).toHaveBeenCalledWith('Solving Cloudflare Turnstile captcha');
    });

    it('should use proxy when provided', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: { errorId: 0, taskId: 'task-123' },
        })
        .mockResolvedValueOnce({
          data: { errorId: 0, status: 'ready', solution: { token: 'proxy-token' } },
        });

      await capSolver.solveTurnstile(
        'https://example.com',
        'site-key',
        'proxy-host:8080:username:password'
      );

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.capsolver.com/createTask',
        expect.objectContaining({
          task: expect.objectContaining({
            type: 'AntiTurnstileTask',
            proxy: 'proxy-host:8080',
            proxyLogin: 'username',
            proxyPassword: 'password',
          }),
        }),
        expect.any(Object)
      );
    });
  });
});

describe('detectCaptchaType', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      $: vi.fn(),
      evaluate: vi.fn(),
    };
  });

  it('should detect Cloudflare Turnstile', async () => {
    const mockElement = {};
    mockPage.$.mockImplementation((selector: string) => {
      if (selector === '[data-sitekey]') return Promise.resolve(mockElement);
      if (selector === '.cf-turnstile') return Promise.resolve(mockElement);
      return Promise.resolve(null);
    });
    mockPage.evaluate.mockResolvedValue('test-sitekey');

    const result = await detectCaptchaType(mockPage);

    expect(result).toEqual({
      type: 'turnstile',
      siteKey: 'test-sitekey',
    });
  });

  it('should detect reCAPTCHA v2', async () => {
    const mockElement = {};
    mockPage.$.mockImplementation((selector: string) => {
      if (selector === '[data-sitekey], .g-recaptcha') return Promise.resolve(mockElement);
      return Promise.resolve(null);
    });
    mockPage.evaluate
      .mockResolvedValueOnce('recaptcha-sitekey')
      .mockResolvedValueOnce(false); // Not v3

    const result = await detectCaptchaType(mockPage);

    expect(result).toEqual({
      type: 'recaptcha-v2',
      siteKey: 'recaptcha-sitekey',
    });
  });

  it('should detect reCAPTCHA v3', async () => {
    const mockElement = {};
    mockPage.$.mockImplementation((selector: string) => {
      if (selector === '[data-sitekey], .g-recaptcha') return Promise.resolve(mockElement);
      return Promise.resolve(null);
    });
    mockPage.evaluate
      .mockResolvedValueOnce('recaptcha-sitekey')
      .mockResolvedValueOnce(true); // Is v3

    const result = await detectCaptchaType(mockPage);

    expect(result).toEqual({
      type: 'recaptcha-v3',
      siteKey: 'recaptcha-sitekey',
    });
  });

  it('should detect hCaptcha', async () => {
    const mockElement = {};
    mockPage.$.mockImplementation((selector: string) => {
      if (selector === '[data-sitekey].h-captcha, [data-hcaptcha-sitekey]') {
        return Promise.resolve(mockElement);
      }
      return Promise.resolve(null);
    });
    mockPage.evaluate.mockResolvedValue('hcaptcha-sitekey');

    const result = await detectCaptchaType(mockPage);

    expect(result).toEqual({
      type: 'hcaptcha',
      siteKey: 'hcaptcha-sitekey',
    });
  });

  it('should return null when no captcha found', async () => {
    mockPage.$.mockResolvedValue(null);

    const result = await detectCaptchaType(mockPage);

    expect(result).toEqual({ type: null });
  });
});

describe('injectCaptchaSolution', () => {
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
    };
  });

  it('should inject Turnstile solution', async () => {
    await injectCaptchaSolution(mockPage, 'turnstile', 'test-token');

    expect(mockPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'test-token'
    );
  });

  it('should inject reCAPTCHA solution', async () => {
    await injectCaptchaSolution(mockPage, 'recaptcha-v2', 'test-token');

    expect(mockPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'test-token'
    );
  });

  it('should inject hCaptcha solution', async () => {
    await injectCaptchaSolution(mockPage, 'hcaptcha', 'test-token');

    expect(mockPage.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      'test-token'
    );
  });
}); 