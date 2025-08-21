import { generateInputHash, generateIdentifier } from './create-payment';
import { createPayment, type MasumiConfig } from './create-payment';
import { pollPaymentStatus } from './check-payment-status';
import { Job, JobStorage, JobStatus, VALID_JOB_STATUSES } from '../../shared/types';

/**
 * process operation based on trigger context or manual mode
 * pure testable function
 */
export async function processOperation(
	inputData: any,
	operationMode: string,
	credentials: any,
	storage: JobStorage,
): Promise<any> {
	// determine actual operation
	let operation = operationMode;
	if (operationMode === 'auto' && inputData._triggerType) {
		operation = mapTriggerToOperation(inputData._triggerType);
	}

	// handle error responses from trigger
	if (inputData.error) {
		return {
			json: {
				error: inputData.error,
				message: inputData.message,
			},
		};
	}

	// execute operation
	switch (operation) {
		case 'createPayment':
			return handleStartJob(inputData, credentials, storage);
		case 'checkStatus':
			return handleCheckStatus(inputData, credentials, storage);
		case 'availability':
			return handleAvailability();
		case 'inputSchema':
			return handleInputSchema();
		case 'updateStatus':
			return handleUpdateStatus(inputData, credentials, storage);
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}

export function mapTriggerToOperation(triggerType: string): string {
	const mapping: Record<string, string> = {
		'start_job': 'createPayment',
		'status': 'checkStatus',
		'availability': 'availability',
		'input_schema': 'inputSchema',
	};
	return mapping[triggerType] || 'unknown';
}

export async function handleStartJob(
	data: any,
	credentials: any,
	storage: JobStorage,
): Promise<any> {
	// generate job ID
	const jobId = generateIdentifier();
	
	// prepare payment data
	const inputHash = generateInputHash(data.input_data);
	const paymentData = {
		identifierFromPurchaser: generateIdentifier(),
		inputData: data.input_data,
		inputHash: inputHash,
	};
	
	// create payment
	const config: MasumiConfig = {
		paymentServiceUrl: credentials.paymentServiceUrl,
		apiKey: credentials.apiKey,
		agentIdentifier: credentials.agentIdentifier,
		network: credentials.network,
		sellerVkey: credentials.sellerVkey,
	};
	
	const paymentResponse = await createPayment(config, paymentData);
	
	// store job
	const job: Job = {
		job_id: jobId,
		identifier_from_purchaser: data.identifier_from_purchaser,
		input_data: data.input_data,
		status: 'awaiting_payment',
		payment: {
			blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
			payByTime: paymentResponse.data.payByTime,
			submitResultTime: paymentResponse.data.submitResultTime,
			unlockTime: paymentResponse.data.unlockTime,
			externalDisputeUnlockTime: paymentResponse.data.externalDisputeUnlockTime,
			inputHash: inputHash,
		},
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
	
	storeJob(storage, jobId, job);
	
	// return MIP-003 compliant response
	return {
		json: {
			status: 'accepted',
			job_id: jobId,
			message: 'Job accepted, awaiting payment',
			payment: {
				identifierFromPurchaser: paymentData.identifierFromPurchaser,
				network: config.network,
				sellerVkey: config.sellerVkey,
				paymentType: 'Web3CardanoV1',
				...job.payment,
				agentIdentifier: config.agentIdentifier,
			},
		},
	};
}

export async function handleCheckStatus(
	data: any,
	credentials: any,
	storage: JobStorage,
): Promise<any> {
	const jobId = data.job_id;
	
	if (!jobId) {
		return {
			json: {
				error: 'missing_job_id',
				message: 'job_id is required',
			},
		};
	}
	
	const job = getJob(storage, jobId);
	
	if (!job) {
		return {
			json: {
				error: 'job_not_found',
				job_id: jobId,
			},
		};
	}
	
	// check payment status if still awaiting
	if (job.status === 'awaiting_payment' && job.payment?.blockchainIdentifier) {
		const config: MasumiConfig = {
			paymentServiceUrl: credentials.paymentServiceUrl,
			apiKey: credentials.apiKey,
			agentIdentifier: credentials.agentIdentifier,
			network: credentials.network,
			sellerVkey: credentials.sellerVkey,
		};
		
		const paymentStatus = await pollPaymentStatus(
			config,
			job.payment.blockchainIdentifier,
			{ timeoutMinutes: 0.1, intervalSeconds: 0 }, // single check, no wait
		);
		
		if (paymentStatus.payment?.onChainState === 'FundsLocked') {
			job.status = 'processing';
			job.updated_at = new Date().toISOString();
			storeJob(storage, jobId, job);
		}
	}
	
	return { json: job };
}

export function handleAvailability(): any {
	return {
		json: {
			available: true,
			type: 'masumi-agent',
			message: 'Service operational',
			version: '1.0.0',
			timestamp: new Date().toISOString(),
		},
	};
}

export function handleInputSchema(): any {
	return {
		json: {
			inputs: [
				{
					key: 'prompt',
					type: 'text',
					required: true,
					description: 'Main input prompt',
					maxLen: 2000,
				},
				{
					key: 'tone',
					type: 'enum',
					required: false,
					values: ['neutral', 'friendly', 'professional'],
					default: 'neutral',
				},
				{
					key: 'max_length',
					type: 'number',
					required: false,
					min: 100,
					max: 5000,
					default: 1000,
				},
			],
		},
	};
}

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