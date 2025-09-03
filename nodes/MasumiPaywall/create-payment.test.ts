import {
	generateIdentifier,
	preparePaymentData,
	createPayment,
	type MasumiConfig,
	type PaymentData,
} from './create-payment';
import { generateInputHash } from '../../shared/utils';

// Mock fetch for testing HTTP calls
global.fetch = jest.fn();

describe('create-payment functions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('generateInputHash', () => {
		it('should generate consistent SHA256 hash for same input', () => {
			const identifier = 'testid123';
			const input = { data: 'test data', value: 123 };
			const hash1 = generateInputHash(identifier, input);
			const hash2 = generateInputHash(identifier, input);

			expect(hash1).toBe(hash2);
			expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 produces 64 hex chars
		});

		it('should generate different hashes for different inputs', () => {
			const identifier = 'testid123';
			const input1 = { data: 'test data 1' };
			const input2 = { data: 'test data 2' };

			const hash1 = generateInputHash(identifier, input1);
			const hash2 = generateInputHash(identifier, input2);

			expect(hash1).not.toBe(hash2);
		});

		it('should handle complex objects', () => {
			const identifier = 'testid123';
			const complexInput = {
				nested: { deeply: { nested: 'value' } },
				array: [1, 2, 3],
				boolean: true,
			};

			const hash = generateInputHash(identifier, complexInput);
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});
	});

	describe('generateIdentifier', () => {
		it('should generate 14-character hex string', () => {
			const identifier = generateIdentifier();

			expect(identifier).toMatch(/^[a-f0-9]{14}$/);
			expect(identifier).toHaveLength(14);
		});

		it('should generate unique identifiers', () => {
			const identifiers = new Set();

			// Generate 100 identifiers and check they're all unique
			for (let i = 0; i < 100; i++) {
				identifiers.add(generateIdentifier());
			}

			expect(identifiers.size).toBe(100);
		});
	});

	describe('preparePaymentData', () => {
		it('should prepare payment data with generated identifier', () => {
			const inputData = { test: 'data' };
			const result = preparePaymentData(inputData);

			expect(result.identifierFromPurchaser).toMatch(/^[a-f0-9]{14}$/);
			expect(result.inputData).toEqual(inputData);
			expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
		});

		it('should use provided identifier when given', () => {
			const inputData = { test: 'data' };
			const customIdentifier = 'custom12345678';
			const result = preparePaymentData(inputData, customIdentifier);

			expect(result.identifierFromPurchaser).toBe(customIdentifier);
			expect(result.inputData).toEqual(inputData);
		});

		it('should calculate correct hash for input data', () => {
			const inputData = { test: 'specific data' };
			const customIdentifier = 'custom12345678';
			const expectedHash = generateInputHash(customIdentifier, inputData);
			const result = preparePaymentData(inputData, customIdentifier);

			expect(result.inputHash).toBe(expectedHash);
		});
	});

	describe('createPayment', () => {
		const mockConfig: MasumiConfig = {
			paymentServiceUrl: 'https://test.masumi.org/api/v1',
			apiKey: 'test-api-key',
			agentIdentifier: 'test-agent',
			network: 'Preprod',
			sellerVkey: 'test-vkey',
		};

		const mockPaymentData: PaymentData = {
			identifierFromPurchaser: 'test1234567890',
			inputData: { test: 'data' },
			inputHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
		};

		it('should successfully create payment with correct request', async () => {
			const mockResponse = {
				data: {
					blockchainIdentifier: 'blockchain123',
					payByTime: '2024-01-01T12:00:00Z',
					submitResultTime: '2024-01-01T12:30:00Z',
				},
			};

			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await createPayment(mockConfig, mockPaymentData);

			// Verify fetch was called with correct parameters
			expect(global.fetch).toHaveBeenCalledWith('https://test.masumi.org/api/v1/payment/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					token: 'test-api-key',
					accept: 'application/json',
				},
				body: expect.stringContaining('"agentIdentifier":"test-agent"'),
			});

			// Verify response
			expect(result).toEqual(mockResponse);
		});

		it('should throw error on failed request', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				text: async () => 'Invalid API key',
			});

			await expect(createPayment(mockConfig, mockPaymentData)).rejects.toThrow(
				'payment creation failed: 401 Unauthorized - Invalid API key',
			);
		});

		it('should include all required fields in request body', async () => {
			(global.fetch as jest.Mock).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ data: {} }),
			});

			await createPayment(mockConfig, mockPaymentData);

			const callArgs = (global.fetch as jest.Mock).mock.calls[0];
			const requestBody = JSON.parse(callArgs[1].body);

			expect(requestBody).toMatchObject({
				agentIdentifier: 'test-agent',
				network: 'Preprod',
				inputHash: mockPaymentData.inputHash,
				identifierFromPurchaser: 'test1234567890',
				paymentType: 'Web3CardanoV1',
			});
		});
	});
});
