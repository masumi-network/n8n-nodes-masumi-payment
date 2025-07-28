import {
	createPurchase,
	type MasumiConfig,
	type PaymentResponse,
} from './create-purchase';

// Mock fetch for testing HTTP calls
global.fetch = jest.fn();

describe('create-purchase functions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('createPurchase', () => {
		const mockConfig: MasumiConfig = {
			paymentServiceUrl: 'https://test.masumi.org/api/v1',
			apiKey: 'test-api-key',
			agentIdentifier: 'test-agent',
			network: 'Preprod',
			sellerVkey: 'test-vkey',
		};

		const mockPaymentResponse: PaymentResponse = {
			data: {
				blockchainIdentifier: 'blockchain-123',
				payByTime: '2024-01-01T12:00:00.000Z',
				submitResultTime: '2024-01-01T12:30:00.000Z',
				datum: 'datum-value',
				paymentAmount: 1000000,
				scriptAddress: 'script-address-123',
			},
		};

		const identifierFromPurchaser = 'purchaser123456';

		it('should successfully create purchase with correct request', async () => {
			const mockResponse = {
				data: {
					purchaseId: 'purchase-456',
					transactionId: 'tx-789',
					status: 'submitted',
				},
			};

			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await createPurchase(
				mockConfig,
				mockPaymentResponse,
				identifierFromPurchaser
			);

			// Verify fetch was called with correct parameters
			expect(global.fetch).toHaveBeenCalledWith(
				'https://test.masumi.org/api/v1/purchase/',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'token': 'test-api-key',
						'accept': 'application/json',
					},
					body: expect.stringContaining('"network":"Preprod"'),
				}
			);

			// Verify response
			expect(result).toEqual(mockResponse);
		});

		it('should include all required fields in request body', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: {} }),
			});

			await createPurchase(mockConfig, mockPaymentResponse, identifierFromPurchaser);

			const callArgs = (global.fetch as jest.Mock).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody).toMatchObject({
				network: 'Preprod',
				agentIdentifier: 'test-agent',
				blockchainIdentifier: 'blockchain-123',
				payByTime: '2024-01-01T12:00:00.000Z',
				submitResultTime: '2024-01-01T12:30:00.000Z',
				identifierFromPurchaser: 'purchaser123456',
				sellerVkey: 'test-vkey',
				paymentType: 'Web3CardanoV1',
			});
		});

		it('should preserve exact timestamps from payment response', async () => {
			const specificTimestamps = {
				payByTime: '2024-03-15T14:30:45.123Z',
				submitResultTime: '2024-03-15T15:00:45.456Z',
			};

			const paymentWithTimestamps: PaymentResponse = {
				...mockPaymentResponse,
				data: {
					...mockPaymentResponse.data,
					...specificTimestamps,
				},
			};

			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: {} }),
			});

			await createPurchase(mockConfig, paymentWithTimestamps, identifierFromPurchaser);

			const callArgs = (global.fetch as jest.Mock).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody.payByTime).toBe(specificTimestamps.payByTime);
			expect(requestBody.submitResultTime).toBe(specificTimestamps.submitResultTime);
		});

		it('should throw error on failed request', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
				text: async () => 'Invalid purchase data',
			});

			await expect(
				createPurchase(mockConfig, mockPaymentResponse, identifierFromPurchaser)
			).rejects.toThrow(
				'purchase creation failed: 400 Bad Request - Invalid purchase data'
			);
		});

		it('should handle network errors', async () => {
			(global.fetch as jest.Mock).mockRejectedValueOnce(
				new Error('Network error')
			);

			await expect(
				createPurchase(mockConfig, mockPaymentResponse, identifierFromPurchaser)
			).rejects.toThrow('purchase creation failed: Network error');
		});

		it('should handle missing payment data fields gracefully', async () => {
			const incompletePaymentResponse: PaymentResponse = {
				data: {
					blockchainIdentifier: 'blockchain-123',
					payByTime: '2024-01-01T12:00:00.000Z',
					submitResultTime: '2024-01-01T12:30:00.000Z',
					// Missing datum, paymentAmount, scriptAddress
				} as any,
			};

			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: {} }),
			});

			await createPurchase(mockConfig, incompletePaymentResponse, identifierFromPurchaser);

			const callArgs = (global.fetch as jest.Mock).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			// Should include what's available
			expect(requestBody.blockchainIdentifier).toBe('blockchain-123');
			expect(requestBody.payByTime).toBe('2024-01-01T12:00:00.000Z');
			
			// Missing fields should be undefined in the request
			expect(requestBody.inputHash).toBeUndefined();
			expect(requestBody.unlockTime).toBe('undefined'); // String 'undefined'
			expect(requestBody.externalDisputeUnlockTime).toBe('undefined'); // String 'undefined'
		});
	});
});