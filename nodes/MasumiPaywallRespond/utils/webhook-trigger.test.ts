/**
 * Unit tests for webhook trigger utility
 */

import { triggerInternalWebhook, extractTriggerContext } from './webhook-trigger';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock console to avoid noise in tests
const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

describe('triggerInternalWebhook', () => {
	beforeEach(() => {
		mockFetch.mockClear();
		consoleSpy.mockClear();
		consoleErrorSpy.mockClear();
	});

	describe('parameter validation', () => {
		it('should fail when instanceUrl is missing', async () => {
			const result = await triggerInternalWebhook({
				instanceUrl: '',
				webhookPath: '555',
				jobId: 'job123',
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('No instance URL provided');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should fail when jobId is missing', async () => {
			const result = await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '555',
				jobId: '',
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('No job ID provided');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should proceed when webhookPath is missing (using empty path)', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
			});

			const result = await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '',
				jobId: 'job123',
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'https://example.com/webhook/start_polling',
				expect.any(Object),
			);
		});
	});

	describe('URL construction', () => {
		it('should construct URL with webhook path', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
			});

			await triggerInternalWebhook({
				instanceUrl: 'https://masumi-n8n.up.railway.app',
				webhookPath: '555',
				jobId: 'job123',
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'https://masumi-n8n.up.railway.app/webhook/555/start_polling',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ job_id: 'job123' }),
				},
			);
		});

		it('should construct URL without webhook path', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
			});

			await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '',
				jobId: 'job123',
			});

			expect(mockFetch).toHaveBeenCalledWith(
				'https://example.com/webhook/start_polling',
				expect.any(Object),
			);
		});
	});

	describe('HTTP response handling', () => {
		it('should return success for 200 response', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
			});

			const result = await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '555',
				jobId: 'job123',
			});

			expect(result.success).toBe(true);
			expect(result.statusCode).toBe(200);
			expect(result.error).toBeUndefined();
		});

		it('should handle 404 Not Found', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				text: async () => 'The requested webhook "555/start_polling" is not registered.',
			});

			const result = await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '555',
				jobId: 'job123',
			});

			expect(result.success).toBe(false);
			expect(result.statusCode).toBe(404);
			expect(result.error).toContain('HTTP 404');
			expect(result.error).toContain('not registered');
		});

		it('should handle network errors', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const result = await triggerInternalWebhook({
				instanceUrl: 'https://example.com',
				webhookPath: '555',
				jobId: 'job123',
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe('Network error');
		});
	});
});

describe('extractTriggerContext', () => {
	beforeEach(() => {
		consoleSpy.mockClear();
	});

	it('should extract both instanceUrl and webhookPath', () => {
		const inputData = {
			_instanceUrl: 'https://masumi-n8n.up.railway.app',
			_webhookPath: '555',
			other: 'data',
		};

		const result = extractTriggerContext(inputData);

		expect(result.instanceUrl).toBe('https://masumi-n8n.up.railway.app');
		expect(result.webhookPath).toBe('555');
	});

	it('should handle missing context data', () => {
		const inputData = {
			other: 'data',
		};

		const result = extractTriggerContext(inputData);

		expect(result.instanceUrl).toBe('');
		expect(result.webhookPath).toBe('');
	});

	it('should handle null/undefined input', () => {
		const result1 = extractTriggerContext(null);
		const result2 = extractTriggerContext(undefined);

		expect(result1.instanceUrl).toBe('');
		expect(result1.webhookPath).toBe('');
		expect(result2.instanceUrl).toBe('');
		expect(result2.webhookPath).toBe('');
	});
});
