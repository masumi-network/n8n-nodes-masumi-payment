import { JOB_STATUS } from '../../shared/constants';
import { Job, JobStorage, JobStatus, VALID_JOB_STATUSES } from '../../shared/types';
import { type MasumiConfig } from './create-payment';
import { getResultHash } from '../../shared/utils';

// job storage helpers
export function storeJob(storage: JobStorage, jobId: string, job: Job): void {
	if (!storage.jobs) storage.jobs = {};
	storage.jobs[jobId] = job;
}

export function getJob(storage: JobStorage, jobId: string): Job | null {
	return storage.jobs?.[jobId] || null;
}

/**
 * Submits result to payment service when job status is completed
 * This updates the onchain status according to MIP-004 protocol
 */
export async function submitResultToPaymentService(
	config: MasumiConfig,
	blockchainIdentifier: string,
	identifierFromPurchaser: string,
	result: any,
): Promise<void> {
	const { paymentServiceUrl, apiKey, network } = config;
	
	// Generate submitResultHash from the result (MIP-004)
	const submitResultHash = getResultHash(identifierFromPurchaser, result);
	
	try {
		const requestBody = {
			network,
			blockchainIdentifier,
			submitResultHash,
		};
		
		const response = await fetch(`${paymentServiceUrl}/payment/submit-result`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				token: apiKey,
				accept: 'application/json',
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to submit result onchain: ${response.status} ${response.statusText}`);
		}

	} catch (error) {
		throw error;
	}
}

/**
 * Updates job status in storage after business logic completion
 * Also submits result onchain when status is completed
 * Pure testable function with no n8n dependencies
 */
export async function updateJobStatus(
	storage: JobStorage,
	jobId: string,
	status: JobStatus,
	result?: any,
	error?: string,
	config?: MasumiConfig,
): Promise<Job | null> {
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

	// submit result onchain if status is completed and we have the necessary data
	if (status === JOB_STATUS.COMPLETED  && result !== undefined && job.payment?.blockchainIdentifier && config) {
		// Let this throw if it fails - we want to know if on-chain submission didn't work
		// The caller (Node) should handle the error
		await submitResultToPaymentService(config, job.payment.blockchainIdentifier, job.identifier_from_purchaser, result);
	}

	// store updated job
	storeJob(storage, jobId, updatedJob);
	return updatedJob;
}

export async function handleUpdateStatus(inputData: any, credentials: any, storage: JobStorage): Promise<any> {
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

	// create config for onchain submission if we have credentials
	const config: MasumiConfig | undefined = credentials ? {
		paymentServiceUrl: credentials.paymentServiceUrl as string,
		apiKey: credentials.apiKey as string,
		agentIdentifier: credentials.agentIdentifier as string,
		network: credentials.network as string,
		sellerVkey: credentials.sellerVkey as string,
	} : undefined;

	// update job status
	const updatedJob = await updateJobStatus(storage, job_id, status, result, error, config);

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
