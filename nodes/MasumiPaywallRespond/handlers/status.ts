/**
 * Status response handler for Masumi paywall respond node
 * Handles MIP-003 compliant status response for job checking
 */

import { IDataObject } from 'n8n-workflow';
import { JobStorage } from '../../../shared/types';
import { getJob, storeJob } from '../../MasumiPaywall/job-handler';
import { type MasumiConfig } from '../../MasumiPaywall/create-payment';

export interface StatusHandlerOptions {
	credentials: IDataObject;
	jobId: string;
	storage: JobStorage;
}

export interface StatusHandlerResult {
	responseData: any;
	success: boolean;
	error?: string;
}

/**
 * Handles status response - check job status and return MIP-003 compliant response
 */
export async function handleStatusResponse({
	credentials,
	jobId,
	storage,
}: StatusHandlerOptions): Promise<StatusHandlerResult> {
	if (!jobId) {
		return {
			responseData: {
				error: 'missing_job_id',
				message: 'job_id is required for status requests',
			},
			success: false,
			error: 'missing_job_id',
		};
	}

	const job = getJob(storage, jobId);

	if (!job) {
		return {
			responseData: {
				job_id: jobId,
				status: 'failed',
				message: 'Job not found',
			},
			success: false,
			error: 'job_not_found',
		};
	}

	// Track last accessed job_id
	storage.last_job_id = jobId;

	// Check if we need to poll payment status for awaiting_payment jobs
	if (job.status === 'awaiting_payment' && job.payment?.blockchainIdentifier) {
		const config: MasumiConfig = {
			paymentServiceUrl: credentials.paymentServiceUrl as string,
			apiKey: credentials.apiKey as string,
			agentIdentifier: credentials.agentIdentifier as string,
			network: credentials.network as string,
			sellerVkey: credentials.sellerVkey as string,
		};

		// Import pollPaymentStatus for checking current payment state
		const { pollPaymentStatus } = await import('../../MasumiPaywall/check-payment-status');
		const paymentStatus = await pollPaymentStatus(
			config,
			job.payment.blockchainIdentifier,
			{ timeoutMinutes: 0.1, intervalSeconds: 0 }, // single check, no wait
		);

		// Update job status if payment is confirmed
		if (paymentStatus.payment?.onChainState === 'FundsLocked') {
			job.status = 'running';
			job.updated_at = new Date().toISOString();
			storeJob(storage, jobId, job);
		}
	}

	// Create MIP-003 compliant status response
	const responseData: any = {
		job_id: jobId,
		status: job.status,
	};

	// Add optional fields based on job state
	if (job.payment?.payByTime) {
		const parsed = parseInt(job.payment.payByTime);
		if (!isNaN(parsed)) {
			responseData.payByTime = Math.floor(parsed / 1000);
		}
	}

	if (job.result) {
		responseData.result = job.result;
	}

	if (job.error) {
		responseData.message = job.error;
	}

	// Add message for different statuses
	if (job.status === 'awaiting_payment') {
		responseData.message = 'Waiting for payment confirmation on blockchain';
	} else if (job.status === 'running') {
		responseData.message = 'Job is being processed';
	} else if (job.status === 'completed') {
		responseData.message = 'Job completed successfully';
	}

	return {
		responseData,
		success: true,
	};
}
