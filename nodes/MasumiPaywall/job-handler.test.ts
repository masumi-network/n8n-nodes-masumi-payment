import {
	updateJobStatus,
	storeJob,
	getJob,
} from './job-handler';
import { JobStorage, Job } from '../../shared/types';

describe('job-handler', () => {
	let mockStorage: JobStorage;

	beforeEach(() => {
		mockStorage = {
			jobs: {},
		};
	});

	// test helper to create mock job
	function createMockJob(overrides: Partial<Job> = {}): Job {
		return {
			job_id: 'test-job-123',
			identifier_from_purchaser: 'test-purchaser-456',
			input_data: { prompt: 'test prompt' },
			status: 'pending',
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

	describe('updateJobStatus', () => {
		it('should update job status to completed with result', () => {
			// setup: store initial job
			const testJob = createMockJob({ status: 'running' });
			storeJob(mockStorage, testJob.job_id, testJob);
			
			const testResult = { output: 'completed successfully' };
			
			// update job status
			const updatedJob = updateJobStatus(
				mockStorage,
				testJob.job_id,
				'completed',
				testResult,
			);
			
			expect(updatedJob).toBeTruthy();
			expect(updatedJob!.status).toBe('completed');
			expect(updatedJob!.result).toEqual(testResult);
			expect(updatedJob!.updated_at).not.toBe(testJob.updated_at);
		});

		it('should update job status to failed with error', () => {
			const testJob = createMockJob({ status: 'running' });
			storeJob(mockStorage, testJob.job_id, testJob);
			
			const errorMessage = 'Processing failed';
			
			const updatedJob = updateJobStatus(
				mockStorage,
				testJob.job_id,
				'failed',
				undefined,
				errorMessage,
			);
			
			expect(updatedJob).toBeTruthy();
			expect(updatedJob!.status).toBe('failed');
			expect(updatedJob!.error).toBe(errorMessage);
			expect(updatedJob!.result).toBeUndefined();
		});

		it('should return null for non-existent job', () => {
			const updatedJob = updateJobStatus(
				mockStorage,
				'nonexistent-job',
				'completed',
				{ result: 'test' },
			);
			
			expect(updatedJob).toBeNull();
		});
	});
});