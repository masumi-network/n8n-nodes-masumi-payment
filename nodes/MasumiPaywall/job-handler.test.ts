import {
	processOperation,
	mapTriggerToOperation,
	handleStartJob,
	handleCheckStatus,
	handleAvailability,
	handleInputSchema,
	handleUpdateStatus,
	updateJobStatus,
	storeJob,
	getJob,
} from './job-handler';
import { JobStorage, Job } from '../../shared/types';

// mock external dependencies
jest.mock('./create-payment');
jest.mock('./check-payment-status');

import { generateInputHash, generateIdentifier, createPayment } from './create-payment';
import { pollPaymentStatus } from './check-payment-status';

const mockGenerateInputHash = generateInputHash as jest.MockedFunction<typeof generateInputHash>;
const mockGenerateIdentifier = generateIdentifier as jest.MockedFunction<typeof generateIdentifier>;
const mockCreatePayment = createPayment as jest.MockedFunction<typeof createPayment>;
const mockPollPaymentStatus = pollPaymentStatus as jest.MockedFunction<typeof pollPaymentStatus>;

describe('job-handler', () => {
	const mockCredentials = {
		paymentServiceUrl: 'https://test.masumi.network',
		apiKey: 'test-api-key',
		agentIdentifier: 'test-agent',
		network: 'Preprod',
		sellerVkey: 'test-vkey',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		
		// setup default mocks
		mockGenerateInputHash.mockReturnValue('test-hash-123');
		mockGenerateIdentifier.mockReturnValueOnce('job-123').mockReturnValueOnce('purchaser-456');
		mockCreatePayment.mockResolvedValue({
			status: 'success',
			data: {
				id: 'payment-123',
				blockchainIdentifier: 'blockchain-456',
				payByTime: '2023-01-01T01:00:00.000Z',
				submitResultTime: '2023-01-01T02:00:00.000Z',
				unlockTime: '2023-01-01T03:00:00.000Z',
				externalDisputeUnlockTime: '2023-01-01T04:00:00.000Z',
				inputHash: 'test-hash-123',
				onChainState: null,
				NextAction: {
					requestedAction: '',
					resultHash: null,
					errorType: null,
					errorNote: null,
				},
				RequestedFunds: [{ amount: '1000000', unit: 'lovelace' }],
				PaymentSource: {
					network: 'Preprod',
					smartContractAddress: 'addr_test123',
					policyId: 'policy123',
					paymentType: 'Web3CardanoV1',
				},
				SmartContractWallet: {
					walletVkey: 'test-vkey',
					walletAddress: 'addr_test456',
				},
				metadata: 'test metadata',
			},
		});
	});

	describe('mapTriggerToOperation', () => {
		it('should map trigger types to operations correctly', () => {
			expect(mapTriggerToOperation('start_job')).toBe('createPayment');
			expect(mapTriggerToOperation('status')).toBe('checkStatus');
			expect(mapTriggerToOperation('availability')).toBe('availability');
			expect(mapTriggerToOperation('input_schema')).toBe('inputSchema');
		});

		it('should return unknown for unmapped trigger types', () => {
			expect(mapTriggerToOperation('unknown')).toBe('unknown');
		});
	});

	describe('processOperation', () => {
		it('should auto-detect operation from trigger context', async () => {
			const inputData = {
				_triggerType: 'start_job',
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test prompt' },
			};
			
			const result = await processOperation(
				inputData,
				'auto',
				mockCredentials,
				{},
			);
			
			expect(result.json.status).toBe('accepted');
			expect(result.json.job_id).toBe('job-123');
		});

		it('should use manual operation mode when not auto', async () => {
			const inputData = {
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test prompt' },
			};
			
			const result = await processOperation(
				inputData,
				'createPayment',
				mockCredentials,
				{},
			);
			
			expect(result.json.status).toBe('accepted');
		});

		it('should handle error responses from trigger', async () => {
			const inputData = {
				error: 'invalid_input',
				message: 'Missing required fields',
			};
			
			const result = await processOperation(
				inputData,
				'auto',
				mockCredentials,
				{},
			);
			
			expect(result.json.error).toBe('invalid_input');
			expect(result.json.message).toBe('Missing required fields');
		});

		it('should throw error for unknown operation', async () => {
			const inputData = { _triggerType: 'unknown' };
			
			await expect(processOperation(
				inputData,
				'auto',
				mockCredentials,
				{},
			)).rejects.toThrow('Unknown operation: unknown');
		});
	});

	describe('handleStartJob', () => {
		it('should create payment and store job correctly', async () => {
			const inputData = {
				identifier_from_purchaser: 'test-purchaser',
				input_data: { prompt: 'test prompt' },
			};
			const storage: JobStorage = {};

			const result = await handleStartJob(inputData, mockCredentials, storage);

			expect(mockCreatePayment).toHaveBeenCalledWith(
				expect.objectContaining({
					paymentServiceUrl: mockCredentials.paymentServiceUrl,
					apiKey: mockCredentials.apiKey,
				}),
				expect.objectContaining({
					identifierFromPurchaser: 'purchaser-456',
					inputData: inputData.input_data,
					inputHash: 'test-hash-123',
				}),
			);

			expect(result.json.status).toBe('accepted');
			expect(result.json.job_id).toBe('job-123');
			expect(result.json.payment.identifierFromPurchaser).toBe('purchaser-456');
			expect(storage.jobs?.['job-123']).toBeDefined();
		});

		it('should generate proper job structure', async () => {
			const inputData = {
				identifier_from_purchaser: 'test-purchaser',
				input_data: { prompt: 'test prompt' },
			};
			const storage: JobStorage = {};

			await handleStartJob(inputData, mockCredentials, storage);

			const storedJob = storage.jobs?.['job-123'];
			expect(storedJob).toEqual({
				job_id: 'job-123',
				identifier_from_purchaser: 'test-purchaser',
				input_data: { prompt: 'test prompt' },
				status: 'awaiting_payment',
				payment: {
					blockchainIdentifier: 'blockchain-456',
					payByTime: '2023-01-01T01:00:00.000Z',
					submitResultTime: '2023-01-01T02:00:00.000Z',
					unlockTime: '2023-01-01T03:00:00.000Z',
					externalDisputeUnlockTime: '2023-01-01T04:00:00.000Z',
					inputHash: 'test-hash-123',
				},
				created_at: expect.any(String),
				updated_at: expect.any(String),
			});
		});
	});

	describe('handleCheckStatus', () => {
		it('should return error when job_id missing', async () => {
			const inputData = {};
			
			const result = await handleCheckStatus(inputData, mockCredentials, {});
			
			expect(result.json.error).toBe('missing_job_id');
			expect(result.json.message).toBe('job_id is required');
		});

		it('should return error when job not found', async () => {
			const inputData = { job_id: 'nonexistent' };
			
			const result = await handleCheckStatus(inputData, mockCredentials, {});
			
			expect(result.json.error).toBe('job_not_found');
			expect(result.json.job_id).toBe('nonexistent');
		});

		it('should return job when found', async () => {
			const job: Job = {
				job_id: 'test-job',
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test' },
				status: 'done',
				created_at: '2023-01-01T00:00:00.000Z',
				updated_at: '2023-01-01T00:00:00.000Z',
			};
			const storage: JobStorage = { jobs: { 'test-job': job } };
			const inputData = { job_id: 'test-job' };
			
			const result = await handleCheckStatus(inputData, mockCredentials, storage);
			
			expect(result.json).toEqual(job);
		});

		it('should check payment status and update job when awaiting payment', async () => {
			const job: Job = {
				job_id: 'test-job',
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test' },
				status: 'awaiting_payment',
				payment: {
					blockchainIdentifier: 'blockchain-123',
					payByTime: '2023-01-01T01:00:00.000Z',
					submitResultTime: '2023-01-01T02:00:00.000Z',
					unlockTime: '2023-01-01T03:00:00.000Z',
					externalDisputeUnlockTime: '2023-01-01T04:00:00.000Z',
					inputHash: 'hash-123',
				},
				created_at: '2023-01-01T00:00:00.000Z',
				updated_at: '2023-01-01T00:00:00.000Z',
			};
			const storage: JobStorage = { jobs: { 'test-job': job } };
			const inputData = { job_id: 'test-job' };

			mockPollPaymentStatus.mockResolvedValue({
				success: true,
				payment: { onChainState: 'FundsLocked' },
				status: 'FundsLocked',
				message: 'Payment confirmed',
			});
			
			const result = await handleCheckStatus(inputData, mockCredentials, storage);
			
			expect(mockPollPaymentStatus).toHaveBeenCalledWith(
				expect.objectContaining(mockCredentials),
				'blockchain-123',
				{ timeoutMinutes: 0.1, intervalSeconds: 0 },
			);
			expect(result.json.status).toBe('processing');
			expect(storage.jobs?.['test-job']?.status).toBe('processing');
		});
	});

	describe('handleAvailability', () => {
		it('should return availability status', () => {
			const result = handleAvailability();
			
			expect(result.json).toEqual({
				available: true,
				type: 'masumi-agent',
				message: 'Service operational',
				version: '1.0.0',
				timestamp: expect.any(String),
			});
		});
	});

	describe('handleInputSchema', () => {
		it('should return input schema', () => {
			const result = handleInputSchema();
			
			expect(result.json.inputs).toHaveLength(3);
			expect(result.json.inputs[0]).toEqual({
				key: 'prompt',
				type: 'text',
				required: true,
				description: 'Main input prompt',
				maxLen: 2000,
			});
		});
	});

	describe('job storage helpers', () => {
		it('should store and retrieve jobs correctly', () => {
			const storage: JobStorage = {};
			const job: Job = {
				job_id: 'test-123',
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test' },
				status: 'awaiting_payment',
				created_at: '2023-01-01T00:00:00.000Z',
				updated_at: '2023-01-01T00:00:00.000Z',
			};
			
			storeJob(storage, 'test-123', job);
			const retrieved = getJob(storage, 'test-123');
			
			expect(retrieved).toEqual(job);
			expect(storage.jobs?.['test-123']).toEqual(job);
		});

		it('should return null for nonexistent jobs', () => {
			const storage: JobStorage = {};
			
			const result = getJob(storage, 'nonexistent');
			
			expect(result).toBeNull();
		});

		it('should initialize jobs object if not present', () => {
			const storage: JobStorage = {};
			const job: Job = {
				job_id: 'test-123',
				identifier_from_purchaser: 'test-id',
				input_data: { prompt: 'test' },
				status: 'awaiting_payment',
				created_at: '2023-01-01T00:00:00.000Z',
				updated_at: '2023-01-01T00:00:00.000Z',
			};
			
			storeJob(storage, 'test-123', job);
			
			expect(storage.jobs).toBeDefined();
			expect(storage.jobs?.['test-123']).toEqual(job);
		});
	});

	describe('updateJobStatus', () => {
		it('should update job status to done with result', () => {
			const storage: JobStorage = {
				jobs: {
					'test-job': {
						job_id: 'test-job',
						identifier_from_purchaser: 'test-id',
						input_data: { prompt: 'test' },
						status: 'processing',
						created_at: '2023-01-01T00:00:00.000Z',
						updated_at: '2023-01-01T00:00:00.000Z',
					},
				},
			};

			const result = { output: 'Generated content' };
			const updatedJob = updateJobStatus(storage, 'test-job', 'done', result);

			expect(updatedJob?.status).toBe('done');
			expect(updatedJob?.result).toEqual(result);
			expect(updatedJob?.updated_at).not.toBe('2023-01-01T00:00:00.000Z');
		});

		it('should update job status to failed with error', () => {
			const storage: JobStorage = {
				jobs: {
					'test-job': {
						job_id: 'test-job',
						identifier_from_purchaser: 'test-id',
						input_data: { prompt: 'test' },
						status: 'processing',
						created_at: '2023-01-01T00:00:00.000Z',
						updated_at: '2023-01-01T00:00:00.000Z',
					},
				},
			};

			const updatedJob = updateJobStatus(storage, 'test-job', 'failed', undefined, 'Processing failed');

			expect(updatedJob?.status).toBe('failed');
			expect(updatedJob?.error).toBe('Processing failed');
		});

		it('should return null for non-existent job', () => {
			const storage: JobStorage = {};
			const updatedJob = updateJobStatus(storage, 'nonexistent', 'done');
			expect(updatedJob).toBeNull();
		});
	});

	describe('handleUpdateStatus', () => {
		it('should update job status successfully', async () => {
			const inputData = {
				job_id: 'test-job',
				status: 'done',
				result: { output: 'Generated content' },
			};

			const storage: JobStorage = {
				jobs: {
					'test-job': {
						job_id: 'test-job',
						identifier_from_purchaser: 'test-id',
						input_data: { prompt: 'test' },
						status: 'processing',
						created_at: '2023-01-01T00:00:00.000Z',
						updated_at: '2023-01-01T00:00:00.000Z',
					},
				},
			};

			const result = await handleUpdateStatus(inputData, {}, storage);

			expect(result.json.success).toBe(true);
			expect(result.json.job.status).toBe('done');
			expect(result.json.job.result).toEqual({ output: 'Generated content' });
		});

		it('should return error for missing job_id', async () => {
			const inputData = { status: 'done' };
			const result = await handleUpdateStatus(inputData, {}, {});

			expect(result.json.error).toBe('missing_job_id');
		});

		it('should return error for invalid status', async () => {
			const inputData = { job_id: 'test', status: 'invalid' };
			const result = await handleUpdateStatus(inputData, {}, {});

			expect(result.json.error).toBe('invalid_status');
		});

		it('should return error for non-existent job', async () => {
			const inputData = { job_id: 'nonexistent', status: 'done' };
			const storage: JobStorage = {};

			const result = await handleUpdateStatus(inputData, {}, storage);

			expect(result.json.error).toBe('job_not_found');
			expect(result.json.job_id).toBe('nonexistent');
		});
	});
});