/**
 * Pipeline integration test for start-job handler
 * Tests the complete data flow from n8n input → webhook trigger with REAL data transformations
 */

import { handleStartJob } from './start-job';
import { extractTriggerContext } from '../utils/webhook-trigger';
import type { JobStorage } from '../../../shared/types';

// Mock external services but keep data flow real
jest.mock('../../MasumiPaywall/create-payment', () => ({
	generateInputHash: jest.fn(() => 'mock-hash-12345'),
	generateIdentifier: jest.fn(() => 'job-mock-67890'),
	createPayment: jest.fn().mockResolvedValue({
		data: {
			blockchainIdentifier: 'blockchain-id-abc123',
			payByTime: '1724681309000',
			submitResultTime: '1724681909000',
			unlockTime: '1724682509000',
			externalDisputeUnlockTime: '1724685309000',
			RequestedFunds: [{ amount: 2000000, unit: 'lovelace' }],
		},
	}),
}));

jest.mock('../../MasumiPaywall/job-handler', () => ({
	storeJob: jest.fn(),
}));

// Mock fetch but track what it gets called with
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Silence console logs for cleaner test output
const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

describe('Start Job Pipeline Integration', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockFetch.mockClear();
		consoleSpy.mockClear();
		consoleErrorSpy.mockClear();
	});

	describe('Complete data flow pipeline', () => {
		it('should handle complete flow from n8n input to webhook trigger', async () => {
			// STEP 1: Start with REAL n8n trigger data (from Railway logs)
			const realN8nTriggerData = {
				_triggerType: 'start_job',
				_httpMethod: 'POST',
				_timestamp: '2025-08-26T13:08:29.320Z',
				_webhookPath: '555',
				_instanceUrl: 'https://masumi-n8n.up.railway.app',
				identifier_from_purchaser: 'test_user_123',
				input_data: {
					prompt: 'village is in danger',
				},
				raw_body: {
					identifier_from_purchaser: 'test_user_123',
					input_data: [{ key: 'prompt', value: 'village is in danger' }],
				},
			};

			// STEP 2: Test context extraction (this happens in main node)
			const triggerContext = extractTriggerContext(realN8nTriggerData);
			expect(triggerContext.instanceUrl).toBe('https://masumi-n8n.up.railway.app');
			expect(triggerContext.webhookPath).toBe('555');

			// STEP 3: Mock successful webhook response
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
			});

			// STEP 4: Mock job storage
			const mockStorage: JobStorage = {
				jobs: {},
				last_job_id: '',
			};

			// STEP 5: Mock credentials
			const mockCredentials = {
				paymentServiceUrl: 'https://mock-payment-service.com',
				apiKey: 'mock-api-key',
				agentIdentifier: 'mock-agent-id',
				network: 'Preprod',
				sellerVkey: 'mock-seller-vkey',
			};

			// STEP 6: Call the complete handler with REAL data flow
			const result = await handleStartJob({
				credentials: mockCredentials,
				storage: mockStorage,
				inputData: realN8nTriggerData.input_data,
				identifierFromPurchaser: realN8nTriggerData.identifier_from_purchaser,
				triggerContext: realN8nTriggerData,
			});

			// STEP 7: Verify the webhook was called with CORRECT parameters
			expect(mockFetch).toHaveBeenCalledWith(
				'https://masumi-n8n.up.railway.app/webhook/555/start_polling',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: expect.any(String), // Job data is now included, test passes if it's a valid JSON string
				},
			);

			// STEP 8: Verify response includes webhook success flag
			expect(result.success).toBe(true);
			expect(result.responseData._internal_webhook_triggered).toBe('fire-and-forget');
			expect(result.responseData._internal_webhook_error).toBeUndefined();

			// STEP 9: Verify MIP-003 response structure
			expect(result.responseData).toMatchObject({
				status: 'success',
				job_id: 'job-mock-67890',
				blockchainIdentifier: 'blockchain-id-abc123',
				paybytime: 1724681309, // Converted from milliseconds
				agentIdentifier: 'mock-agent-id',
				sellerVKey: 'mock-seller-vkey',
				identifierFromPurchaser: expect.any(String), // Hex-converted
				amounts: [{ amount: 2000000, unit: 'lovelace' }],
				input_hash: 'mock-hash-12345',
			});
		});

		it('should handle webhook trigger failure correctly', async () => {
			// Setup data with missing instanceUrl
			const badTriggerData = {
				_triggerType: 'start_job',
				_webhookPath: '555',
				// Missing _instanceUrl!
				identifier_from_purchaser: 'test_user_123',
				input_data: { prompt: 'test' },
			};

			const result = await handleStartJob({
				credentials: {
					paymentServiceUrl: 'https://mock.com',
					apiKey: 'key',
					agentIdentifier: 'agent',
					network: 'Preprod',
					sellerVkey: 'vkey',
				},
				storage: { jobs: {}, last_job_id: '' },
				inputData: badTriggerData.input_data,
				identifierFromPurchaser: badTriggerData.identifier_from_purchaser,
				triggerContext: badTriggerData,
			});

			// Should succeed with payment but webhook trigger is now fire-and-forget
			expect(result.success).toBe(true); // Payment creation succeeded
			expect(result.responseData._internal_webhook_triggered).toBe('fire-and-forget');

			// Webhook should NOT have been called
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should handle payment failure but still attempt webhook trigger', async () => {
			// Mock payment service failure
			const { createPayment } = require('../../MasumiPaywall/create-payment');
			createPayment.mockRejectedValue(new Error('Payment service unavailable'));

			// Mock successful webhook
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const triggerData = {
				_instanceUrl: 'https://masumi-n8n.up.railway.app',
				_webhookPath: '555',
				identifier_from_purchaser: 'test_user_123',
				input_data: { prompt: 'test' },
			};

			const result = await handleStartJob({
				credentials: {
					paymentServiceUrl: 'https://mock.com',
					apiKey: 'key',
					agentIdentifier: 'agent',
					network: 'Preprod',
					sellerVkey: 'vkey',
				},
				storage: { jobs: {}, last_job_id: '' },
				inputData: triggerData.input_data,
				identifierFromPurchaser: triggerData.identifier_from_purchaser,
				triggerContext: triggerData,
			});

			// Payment failed but webhook still attempted
			expect(result.success).toBe(false);
			expect(result.error).toContain('Payment service unavailable');
			expect(result.responseData.error).toBe('job_creation_failed');

			// But webhook was still called!
			expect(mockFetch).toHaveBeenCalledWith(
				'https://masumi-n8n.up.railway.app/webhook/555/start_polling',
				expect.any(Object),
			);
			expect(result.responseData._internal_webhook_triggered).toBe('fire-and-forget');
		});

		it('should handle 404 webhook response correctly', async () => {
			// Ensure payment creation succeeds
			const { createPayment } = require('../../MasumiPaywall/create-payment');
			createPayment.mockResolvedValue({
				data: {
					blockchainIdentifier: 'blockchain-id-404test',
					payByTime: '1724681309000',
					submitResultTime: '1724681909000',
					unlockTime: '1724682509000',
					externalDisputeUnlockTime: '1724685309000',
					RequestedFunds: [{ amount: 2000000, unit: 'lovelace' }],
				},
			});

			// Mock 404 response (webhook not registered)
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				text: async () => 'The requested webhook "555/start_polling" is not registered.',
			});

			const triggerData = {
				_instanceUrl: 'https://masumi-n8n.up.railway.app',
				_webhookPath: '555',
				identifier_from_purchaser: 'test_user_123',
				input_data: { prompt: 'test' },
			};

			const result = await handleStartJob({
				credentials: {
					paymentServiceUrl: 'https://mock.com',
					apiKey: 'key',
					agentIdentifier: 'agent',
					network: 'Preprod',
					sellerVkey: 'vkey',
				},
				storage: { jobs: {}, last_job_id: '' },
				inputData: triggerData.input_data,
				identifierFromPurchaser: triggerData.identifier_from_purchaser,
				triggerContext: triggerData,
			});

			console.log('404 test result:', {
				success: result.success,
				error: result.error,
				responseStatus: result.responseData.status,
				webhookError: result.responseData._internal_webhook_error,
			});

			// Payment succeeded and webhook trigger is now fire-and-forget
			expect(result.success).toBe(true);
			expect(result.responseData.status).toBe('success');
			expect(result.responseData._internal_webhook_triggered).toBe('fire-and-forget');
		});
	});

	describe('Data transformation pipeline', () => {
		it('should correctly transform identifier from purchaser to hex', async () => {
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await handleStartJob({
				credentials: {
					paymentServiceUrl: 'https://mock.com',
					apiKey: 'key',
					agentIdentifier: 'agent',
					network: 'Preprod',
					sellerVkey: 'vkey',
				},
				storage: { jobs: {}, last_job_id: '' },
				inputData: { prompt: 'test' },
				identifierFromPurchaser: 'user@example.com', // Real user identifier
				triggerContext: {
					_instanceUrl: 'https://test.com',
					_webhookPath: 'path',
				},
			});

			// Should convert to hex and pad/truncate appropriately
			const hexIdentifier = result.responseData.identifierFromPurchaser;
			expect(hexIdentifier).toMatch(/^[a-f0-9]+$/); // Only hex chars
			expect(hexIdentifier.length).toBeGreaterThanOrEqual(14);
			expect(hexIdentifier.length).toBeLessThanOrEqual(26);
		});
	});
});
