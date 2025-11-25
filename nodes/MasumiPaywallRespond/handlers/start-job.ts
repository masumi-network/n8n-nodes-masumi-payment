/**
 * Start job handler for Masumi paywall respond node
 * Handles payment creation, job storage, and webhook triggering
 */

import { IDataObject } from 'n8n-workflow';
import { JobStorage, Job } from '../../../shared/types';
import { storeJob } from '../../MasumiPaywall/job-handler';
import {
	generateIdentifier,
	createPayment,
	type MasumiConfig,
} from '../../MasumiPaywall/create-payment';
import { generateInputHash } from '../../../shared/utils';
import { JOB_STATUS } from '../../../shared/constants';
import {
	triggerInternalWebhook,
	extractTriggerContext,
	type WebhookTriggerResult,
} from '../utils/webhook-trigger';

export interface StartJobHandlerOptions {
	credentials: IDataObject;
	storage: JobStorage;
	inputData: any;
	identifierFromPurchaser: string;
	triggerContext: any; // Input data from trigger node
}

export interface StartJobResult {
	responseData: any;
	success: boolean;
	error?: string;
	webhookTriggerResult?: WebhookTriggerResult;
}

/**
 * Handles the complete start_job flow:
 * 1. Creates payment request
 * 2. Stores job data
 * 3. Triggers internal webhook (ALWAYS, even if payment fails)
 * 4. Returns MIP-003 compliant response
 */
export async function handleStartJob({
	credentials,
	storage,
	inputData,
	identifierFromPurchaser,
	triggerContext,
}: StartJobHandlerOptions): Promise<StartJobResult> {

	// Parse input data if it's a string
	let parsedInputData: any;
	try {
		parsedInputData = typeof inputData === 'string' ? JSON.parse(inputData) : inputData;
	} catch {
		parsedInputData = inputData;
	}

	// Generate job ID - this should always succeed
	const jobId = generateIdentifier();

	// Generate input hash
	const inputHash = generateInputHash(identifierFromPurchaser, parsedInputData);

	// Extract webhook trigger context
	const { instanceUrl, webhookPath } = extractTriggerContext(triggerContext);

	// Initialize result object and job holder
	let result: StartJobResult = {
		responseData: {},
		success: false,
	};
	let job: Job | undefined = undefined;

	// Attempt payment creation and job storage
	try {

		const paymentData = {
			identifierFromPurchaser,
			inputData: parsedInputData,
			inputHash: inputHash,
		};

		// Create payment request
		const config: MasumiConfig = {
			paymentServiceUrl: credentials.paymentServiceUrl as string,
			apiKey: credentials.apiKey as string,
			agentIdentifier: credentials.agentIdentifier as string,
			network: credentials.network as string,
			sellerVkey: credentials.sellerVkey as string,
		};

		const paymentResponse = await createPayment(config, paymentData);

		// Store job in workflow static data
		job = {
			job_id: jobId,
			identifier_from_purchaser: identifierFromPurchaser,
			input_data: parsedInputData,
			status: JOB_STATUS.AWAITING_PAYMENT,
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
		storage.last_job_id = jobId;

		// Create MIP-003 compliant start_job response
		result.responseData = {
			status: 'success',
			job_id: jobId,
			blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
			payByTime: paymentResponse.data.payByTime,
			submitResultTime: paymentResponse.data.submitResultTime,
			unlockTime: paymentResponse.data.unlockTime,
			externalDisputeUnlockTime: paymentResponse.data.externalDisputeUnlockTime,
			agentIdentifier: config.agentIdentifier,
			sellerVKey: config.sellerVkey,
			identifierFromPurchaser: identifierFromPurchaser,
			amounts: paymentResponse.data.RequestedFunds || [
				{
					amount: 3000000,
					unit: 'lovelace',
				},
			],
			input_hash: inputHash,
		};

		result.success = true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Return error response for failed job creation
		result.responseData = {
			error: 'job_creation_failed',
			message: `Failed to create job: ${errorMessage}`,
			job_id: jobId, // Still include the job ID for tracking
			identifierFromPurchaser: identifierFromPurchaser, // Include hex identifier even in error case
		};

		result.success = false;
		result.error = errorMessage;
	}

	// CRITICAL: Trigger the internal webhook as fire-and-forget to avoid blocking response

	// Fire-and-forget: don't await the webhook trigger
	triggerInternalWebhook({
		instanceUrl,
		webhookPath,
		jobId,
		job: result.success ? job : undefined, // Pass job data if creation succeeded
	})
		.then(webhookTriggerResult => {
			if (!webhookTriggerResult.success) {
				// Silently fail or use n8n logging if possible, but console.error is restricted
			}
		})
		.catch(error => {
			// Silently fail
		});

	// Include webhook trigger debug info in response (fire-and-forget status)
	result.responseData = {
		...result.responseData,
		_internal_webhook_triggered: 'fire-and-forget',
	};

	return result;
}
