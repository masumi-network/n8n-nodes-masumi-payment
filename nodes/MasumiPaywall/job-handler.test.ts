import { updateJobStatus, storeJob, getJob, submitResultToPaymentService } from './job-handler';
import { JobStorage, Job } from '../../shared/types';
import { JOB_STATUS } from '../../shared/constants';
import { type MasumiConfig } from './create-payment';

// Mock global fetch
global.fetch = jest.fn();

describe('job-handler', () => {
	let mockStorage: JobStorage;
	let mockConfig: MasumiConfig;

	beforeEach(() => {
		mockStorage = {
			jobs: {},
		};
		
		mockConfig = {
			paymentServiceUrl: 'https://test-payment-service.com',
			apiKey: 'test-api-key',
			agentIdentifier: 'test-agent',
			network: 'Preprod',
			sellerVkey: 'test-seller-vkey',
		};

		// Reset fetch mock
		(global.fetch as jest.Mock).mockClear();
	});

	// test helper to create mock job
	function createMockJob(overrides: Partial<Job> = {}): Job {
		return {
			job_id: 'test-job-123',
			identifier_from_purchaser: 'test-purchaser-456',
			input_data: { prompt: 'test prompt' },
			status: JOB_STATUS.PENDING,
			payment: {
				blockchainIdentifier: 'test-blockchain-id',
				payByTime: '1234567890',
				submitResultTime: '1234567891',
				unlockTime: '1234567892',
				externalDisputeUnlockTime: '1234567893',
				inputHash: 'test-input-hash',
			},
			created_at: '2023-01-01T00:00:00.000Z',
			updated_at: '2023-01-01T00:00:00.000Z',
			...overrides,
		};
	}

	describe('job storage helpers', () => {
		it('should store and retrieve jobs correctly', () => {
			const testJob = createMockJob();

			// store job
			storeJob(mockStorage, testJob.job_id, testJob);

			// retrieve job
			const retrievedJob = getJob(mockStorage, testJob.job_id);

			expect(retrievedJob).toEqual(testJob);
		});

		it('should return null for nonexistent jobs', () => {
			const retrievedJob = getJob(mockStorage, 'nonexistent-job-id');

			expect(retrievedJob).toBeNull();
		});

		it('should initialize jobs object if not present', () => {
			// start with storage that has no jobs property
			const emptyStorage: JobStorage = {};
			const testJob = createMockJob();

			// store should initialize the jobs object
			storeJob(emptyStorage, testJob.job_id, testJob);

			expect(emptyStorage.jobs).toBeDefined();
			expect(emptyStorage.jobs![testJob.job_id]).toEqual(testJob);
		});
	});

	describe('submitResultToPaymentService', () => {
		it('should submit result onchain successfully', async () => {
			const mockResponse = { ok: true };
			(global.fetch as jest.Mock).mockResolvedValue(mockResponse);

			const blockchainIdentifier = 'test-blockchain-id';
			const result = { output: 'completed successfully' };

			await expect(
				submitResultToPaymentService(mockConfig, blockchainIdentifier, result)
			).resolves.toBeUndefined();

			expect(global.fetch).toHaveBeenCalledWith(
				'https://test-payment-service.com/payment/submit-result',
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						token: 'test-api-key',
						accept: 'application/json',
					},
					body: JSON.stringify({
						network: 'Preprod',
						blockchainIdentifier: 'test-blockchain-id',
						submitResultHash: 'db647b2059aba8175944a843bc43eaf8f99c51a09351065700245033b5467757', // sha256 of {"output":"completed successfully"}
					}),
				}
			);
		});

		it('should throw error when API call fails', async () => {
			const mockResponse = { ok: false, status: 400, statusText: 'Bad Request', text: () => Promise.resolve('Error message') };
			(global.fetch as jest.Mock).mockResolvedValue(mockResponse);

			const blockchainIdentifier = 'test-blockchain-id';
			const result = { output: 'completed successfully' };

			await expect(
				submitResultToPaymentService(mockConfig, blockchainIdentifier, result)
			).rejects.toThrow('Failed to submit result onchain: 400 Bad Request');
		});
	});

	describe('updateJobStatus', () => {
		it('should update job status to completed with result and submit onchain', async () => {
			// Mock successful API response
			const mockResponse = { ok: true };
			(global.fetch as jest.Mock).mockResolvedValue(mockResponse);

			// setup: store initial job
			const testJob = createMockJob({ status: JOB_STATUS.RUNNING });
			storeJob(mockStorage, testJob.job_id, testJob);

			const testResult = { output: 'completed successfully' };

			// update job status
			const updatedJob = await updateJobStatus(
				mockStorage,
				testJob.job_id,
				JOB_STATUS.COMPLETED,
				testResult,
				undefined,
				mockConfig,
			);

			expect(updatedJob).toBeTruthy();
			expect(updatedJob!.status).toBe(JOB_STATUS.COMPLETED);
			expect(updatedJob!.result).toEqual(testResult);
			expect(updatedJob!.updated_at).not.toBe(testJob.updated_at);
			
			// Verify onchain submission was called
			expect(global.fetch).toHaveBeenCalledWith(
				'https://test-payment-service.com/payment/submit-result',
				expect.objectContaining({
					method: 'POST',
					body: expect.stringContaining('test-blockchain-id'),
				})
			);
		});

		it('should update job status without onchain submission when no config provided', async () => {
			// setup: store initial job
			const testJob = createMockJob({ status: JOB_STATUS.RUNNING });
			storeJob(mockStorage, testJob.job_id, testJob);

			const testResult = { output: 'completed successfully' };

			// update job status without config
			const updatedJob = await updateJobStatus(
				mockStorage,
				testJob.job_id,
				JOB_STATUS.COMPLETED,
				testResult,
			);

			expect(updatedJob).toBeTruthy();
			expect(updatedJob!.status).toBe(JOB_STATUS.COMPLETED);
			expect(updatedJob!.result).toEqual(testResult);
			
			// Verify no onchain submission was attempted
			expect(global.fetch).not.toHaveBeenCalled();
		});

		it('should update job status to failed with error', async () => {
			const testJob = createMockJob({ status: JOB_STATUS.RUNNING });
			storeJob(mockStorage, testJob.job_id, testJob);

			const errorMessage = 'Processing failed';

			const updatedJob = await updateJobStatus(
				mockStorage,
				testJob.job_id,
				JOB_STATUS.FAILED,
				undefined,
				errorMessage,
			);

			expect(updatedJob).toBeTruthy();
			expect(updatedJob!.status).toBe(JOB_STATUS.FAILED);
			expect(updatedJob!.error).toBe(errorMessage);
			expect(updatedJob!.result).toBeUndefined();
		});

		it('should return null for non-existent job', async () => {
			const updatedJob = await updateJobStatus(mockStorage, 'nonexistent-job', JOB_STATUS.COMPLETED, {
				result: 'test',
			});

			expect(updatedJob).toBeNull();
		});
	});
});
