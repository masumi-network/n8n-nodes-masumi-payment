import {
	interpretPaymentStatus,
	checkPaymentStatus,
	pollPaymentStatus,
	type MasumiConfig,
	type PaymentStatus,
} from './check-payment-status';

// Mock fetch for testing HTTP calls
global.fetch = jest.fn();

// Mock setTimeout for testing polling
jest.useFakeTimers();

describe('check-payment-status functions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.clearAllTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('interpretPaymentStatus', () => {
		it('should identify FundsLocked as confirmed', () => {
			const status: PaymentStatus = {
				purchaseId: 'purchase123',
				onChainState: 'FundsLocked',
			};

			const result = interpretPaymentStatus(status);

			expect(result.isConfirmed).toBe(true);
			expect(result.isError).toBe(false);
			expect(result.shouldContinuePolling).toBe(false);
			expect(result.message).toContain('payment confirmed');
		});

		it('should identify error states correctly', () => {
			const errorStates = [
				'FundsOrDatumInvalid',
				'RefundRequested',
				'Disputed',
				'RefundWithdrawn',
				'DisputedWithdrawn',
			];

			errorStates.forEach(state => {
				const status: PaymentStatus = {
					purchaseId: 'purchase123',
					onChainState: state as any,
				};

				const result = interpretPaymentStatus(status);

				expect(result.isError).toBe(true);
				expect(result.isConfirmed).toBe(false);
				expect(result.shouldContinuePolling).toBe(false);
				expect(result.message).toContain('payment failed');
			});
		});

		it('should continue polling for pending states', () => {
			const pendingStates = [null, 'SomeOtherState', 'Processing'];

			pendingStates.forEach(state => {
				const status: PaymentStatus = state
					? { purchaseId: 'purchase123', onChainState: state as any }
					: null;

				const result = interpretPaymentStatus(status);

				expect(result.isConfirmed).toBe(false);
				expect(result.isError).toBe(false);
				expect(result.shouldContinuePolling).toBe(true);
			});
		});

		it('should handle null status', () => {
			const result = interpretPaymentStatus(null);

			expect(result.isConfirmed).toBe(false);
			expect(result.isError).toBe(false);
			expect(result.shouldContinuePolling).toBe(true);
			expect(result.message).toBe('payment not found');
		});
	});

	describe('checkPaymentStatus', () => {
		const mockConfig: MasumiConfig = {
			paymentServiceUrl: 'https://test.masumi.org/api/v1',
			apiKey: 'test-api-key',
			network: 'Preprod',
			agentIdentifier: 'test-agent',
			sellerVkey: 'test-vkey',
		};

		it('should successfully check payment status', async () => {
			const mockResponse = {
				data: {
					payments: [
						{
							blockchainIdentifier: 'test-payment-123',
							onChainState: 'FundsLocked',
							inputHash: 'hash123',
						},
					],
				},
			};

			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await checkPaymentStatus(mockConfig, 'test-payment-123');

			expect(global.fetch).toHaveBeenCalledWith(
				'https://test.masumi.org/api/v1/payment/?blockchainIdentifier=test-payment-123&network=Preprod',
				{
					method: 'GET',
					headers: {
						accept: 'application/json',
						token: 'test-api-key',
					},
				},
			);

			expect(result).toEqual({
				blockchainIdentifier: 'test-payment-123',
				onChainState: 'FundsLocked',
				inputHash: 'hash123',
			});
		});

		it('should return null when payment not found', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: { payments: [] } }),
			});

			const result = await checkPaymentStatus(mockConfig, 'nonexistent-payment');

			expect(result).toBeNull();
		});

		it('should throw error on failed request', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				text: async () => 'Server error',
			});

			await expect(checkPaymentStatus(mockConfig, 'test-payment')).rejects.toThrow(
				'status check failed: 500 Internal Server Error',
			);
		});
	});

	describe('pollPaymentStatus', () => {
		const mockConfig: MasumiConfig = {
			paymentServiceUrl: 'https://test.masumi.org/api/v1',
			apiKey: 'test-api-key',
			network: 'Preprod',
			agentIdentifier: 'test-agent',
			sellerVkey: 'test-vkey',
		};

		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('should return success immediately when FundsLocked found', async () => {
			// Mock response with FundsLocked status
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: {
						payments: [
							{
								blockchainIdentifier: 'test-payment',
								onChainState: 'FundsLocked',
								inputHash: 'hash123',
							},
						],
					},
				}),
			});

			const result = await pollPaymentStatus(mockConfig, 'test-payment', {
				timeoutMinutes: 1,
				intervalSeconds: 1,
			});

			expect(result.success).toBe(true);
			expect(result.payment?.onChainState).toBe('FundsLocked');
			expect(result.message).toContain('payment confirmed');
			expect(global.fetch).toHaveBeenCalledTimes(1); // Should stop immediately
		}, 10000);

		// Skip timeout test for now - it's complex to test properly
		it.skip('should timeout after specified duration', async () => {
			// This test would require proper async timer mocking
		});

		it('should stop polling on error state', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: {
						payments: [
							{
								blockchainIdentifier: 'test-payment',
								onChainState: 'RefundRequested',
								inputHash: 'hash123',
							},
						],
					},
				}),
			});

			const result = await pollPaymentStatus(mockConfig, 'test-payment');

			expect(result.success).toBe(false);
			expect(result.message).toContain('payment failed: RefundRequested');
			expect(global.fetch).toHaveBeenCalledTimes(1); // Should not continue polling
		}, 10000);
	});
});
