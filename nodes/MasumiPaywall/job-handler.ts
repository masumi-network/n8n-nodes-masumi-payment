import { Job, JobStorage, JobStatus, VALID_JOB_STATUSES } from '../../shared/types';

// job storage helpers
export function storeJob(storage: JobStorage, jobId: string, job: Job): void {
	if (!storage.jobs) storage.jobs = {};
	storage.jobs[jobId] = job;
}

export function getJob(storage: JobStorage, jobId: string): Job | null {
	return storage.jobs?.[jobId] || null;
}

/**
 * Updates job status in storage after business logic completion
 * Pure testable function with no n8n dependencies
 */
export function updateJobStatus(
	storage: JobStorage,
	jobId: string,
	status: JobStatus,
	result?: any,
	error?: string
): Job | null {
	// get existing job
	const job = getJob(storage, jobId);
	if (!job) {
		return null;
	}

	// update job with new status
	const updatedJob: Job = {
		...job,
		status,
		updated_at: new Date().toISOString(),
	};

	// add result data if provided
	if (result !== undefined) {
		updatedJob.result = result;
	}

	// add error message if provided
	if (error) {
		updatedJob.error = error;
	}

	// store updated job
	storeJob(storage, jobId, updatedJob);
	return updatedJob;
}

export function handleUpdateStatus(inputData: any, _credentials: any, storage: JobStorage): any {
	const { job_id, status, result, error } = inputData;

	// validate required fields
	if (!job_id) {
		return {
			json: {
				error: 'missing_job_id',
				message: 'job_id is required for status updates',
			},
		};
	}

	if (!status || !VALID_JOB_STATUSES.includes(status as JobStatus)) {
		return {
			json: {
				error: 'invalid_status',
				message: `status must be one of: ${VALID_JOB_STATUSES.join(', ')}`,
			},
		};
	}

	// update job status
	const updatedJob = updateJobStatus(storage, job_id, status, result, error);

	if (!updatedJob) {
		return {
			json: {
				error: 'job_not_found',
				job_id,
			},
		};
	}

	return {
		json: {
			success: true,
			job: updatedJob,
		},
	};
}