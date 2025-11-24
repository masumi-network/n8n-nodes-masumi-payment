import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import type { MasumiConfig } from './create-payment';
import { createPurchase } from './create-purchase';
import { pollPaymentStatus } from './check-payment-status';
import { getJob, updateJobStatus } from './job-handler';
import type { JobStorage } from '../../shared/types';
import { JOB_STATUS } from '../../shared/constants';

// Import package.json to get version automatically
const packageJson = require('../../../package.json');

// All interfaces are now imported from the individual function files
// Helper functions are now imported from create-payment.ts

export class MasumiPaywall implements INodeType {
	description: INodeTypeDescription = {
		displayName: `Masumi Paywall v${packageJson.version}`,
		name: 'masumiPaywall',
		icon: 'file:masumi-logo.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operationMode"]}}',
		description: 'Cardano blockchain paywall for monetizing n8n workflows',
		defaults: {
			name: 'Masumi Paywall',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'masumiPaywallApi',
				required: true,
			},
		],
		// hints: [
		// 	{
		// 		message: `Masumi Node for n8n v${packageJson.version}`,
		// 		type: 'info',
		// 		location: 'ndv',
		// 		whenToDisplay: 'always',
		// 	},
		// ],
		properties: [
			{
				displayName: 'Operation Mode',
				name: 'operationMode',
				type: 'options',
				options: [
					{
						name: 'Poll for Payment',
						value: 'pollForPayment',
						description: 'Poll for external payment confirmation (normal flow)',
					},
					{
						name: 'Purchase and Poll (Testing)',
						value: 'purchaseAndPoll',
						description:
							'Create purchase request and poll (test mode - will timeout without funds)',
					},
				],
				default: 'pollForPayment',
				description: 'Choose paywall operation mode',
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '={{$json.job_id}}',
				required: true,
				description: 'Job ID from payment creation (get from previous respond node)',
				placeholder: 'Enter job ID...',
			},
			{
				displayName: 'Timeout (Minutes)',
				name: 'timeout',
				type: 'number',
				default: 10,
				required: true,
				typeOptions: {
					minValue: 1,
					maxValue: 60,
				},
				description: 'Maximum time to wait for payment confirmation',
			},
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				default: 15,
				required: true,
				typeOptions: {
					minValue: 5,
					maxValue: 120,
				},
				description: 'Time between payment status checks',
			},
			{
				displayName: 'Submit Result Time (Minutes)',
				name: 'submitResultTime',
				type: 'number',
				default: 20,
				required: true,
				typeOptions: {
					minValue: 5,
					maxValue: 300,
				},
				description: 'Time limit for submitting results after payment confirmation',
			},
			{
				displayName:
					'Input: Job ID from previous respond node. Updates job status to "awaiting_payment" → polls blockchain → on payment confirmation updates to "running" and passes data forward. On timeout/failure keeps "awaiting_payment" and blocks workflow.',
				name: 'paywallNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operationMode = this.getNodeParameter('operationMode', 0) as string;
		const timeout = this.getNodeParameter('timeout', 0) as number;
		const pollInterval = this.getNodeParameter('pollInterval', 0) as number;
		const submitResultTimeMinutes = this.getNodeParameter('submitResultTime', 0) as number;

		// get credentials
		const credentials = await this.getCredentials('masumiPaywallApi');
		const storage: JobStorage = this.getWorkflowStaticData('global');

		for (let i = 0; i < items.length; i++) {
			// Get jobId from input data (webhook) or parameters (manual)
			const jobId =
				(items[i].json.job_id as string) || (this.getNodeParameter('jobId', i) as string);

			try {
				// Check if job data was passed directly from webhook trigger
				let job = items[i].json.job_data as any;

				// If no job data in input, try to get from storage
				if (!job) {
					job = getJob(storage, jobId);
				}

				if (!job) {
					throw new NodeOperationError(this.getNode(), `Job not found: ${jobId}`);
				}

				if (!job.payment?.blockchainIdentifier) {
					throw new NodeOperationError(
						this.getNode(),
						`Job ${jobId} has no payment information`,
					);
				}

				// update job status to awaiting_payment (no onchain submission needed for this status)
				await updateJobStatus(storage, jobId, JOB_STATUS.AWAITING_PAYMENT);

				// prepare config
				const config: MasumiConfig = {
					paymentServiceUrl: credentials.paymentServiceUrl as string,
					apiKey: credentials.apiKey as string,
					agentIdentifier: credentials.agentIdentifier as string,
					network: credentials.network as string,
					sellerVkey: credentials.sellerVkey as string,
				};

				// handle purchase mode (test only)
				if (operationMode === 'purchaseAndPoll') {
					console.log(`💰 Creating purchase for testing...`);
					// Calculate submit result time from user input (in minutes)
					const now = new Date();
					const submitResultTime = new Date(now.getTime() + submitResultTimeMinutes * 60 * 1000);
					
					// create mock payment response from job data
					const mockPaymentResponse = {
						status: 'success',
						data: {
							id: job.payment.blockchainIdentifier,
							blockchainIdentifier: job.payment.blockchainIdentifier,
							payByTime: job.payment.payByTime,
							submitResultTime: job.payment.submitResultTime,
							unlockTime: job.payment.unlockTime,
							externalDisputeUnlockTime: job.payment.externalDisputeUnlockTime,
							inputHash: job.payment.inputHash,
							onChainState: null,
							NextAction: {
								requestedAction: 'WaitingForExternalAction',
								resultHash: null,
								errorType: null,
								errorNote: null,
							},
							RequestedFunds: [{ amount: '2000000', unit: '' }],
							PaymentSource: {
								network: config.network,
								smartContractAddress: 'test_address',
								policyId: 'test_policy',
								paymentType: 'Web3CardanoV1',
							},
							SmartContractWallet: {
								walletVkey: config.sellerVkey,
								walletAddress: 'test_address',
							},
							metadata: 'test purchase',
						},
					};

					await createPurchase(
						config,
						mockPaymentResponse,
						job.identifier_from_purchaser,
					);
					console.log(`✅ Purchase created for testing`);
				}

				// poll for payment status
				console.log(`🔄 Polling for payment confirmation...`);
				const finalResult = await pollPaymentStatus(
					config,
					job.payment.blockchainIdentifier,
					{
						timeoutMinutes: timeout,
						intervalSeconds: pollInterval,
					},
				);

				// handle result
				if (finalResult.success && finalResult.payment?.onChainState === 'FundsLocked') {
					// payment confirmed - update status to running and pass data forward (no onchain submission needed for this status)
					await updateJobStatus(storage, jobId, JOB_STATUS.RUNNING);
					console.log(`✅ Payment confirmed! Job ${jobId} is now running`);

					returnData.push({
						json: {
							// business logic indicators
							paymentConfirmed: true,
							jobId: jobId,
							job: job,
							onChainState: finalResult.payment.onChainState,
							// payment details
							blockchainIdentifier: job.payment.blockchainIdentifier,
							inputHash: job.payment.inputHash,
							// final payment state
							finalPaymentState: finalResult.payment,
							// debug info
							debug: {
								operationMode,
								timeoutMinutes: timeout,
								intervalSeconds: pollInterval,
								message: finalResult.message,
								timestamp: new Date().toISOString(),
							},
						},
					});
				} else {
					// payment failed or timeout - keep status as awaiting_payment, throw error
					console.log(
						`❌ Payment not confirmed for job ${jobId}: ${finalResult.message}`,
					);

					// Use actual onChainState from last polling attempt (may be null/undefined)
					const lastOnChainState = finalResult.payment?.onChainState;

					// Format the state for display (clarify that null is a valid blockchain state)
					const stateDisplay =
						lastOnChainState === undefined || lastOnChainState === null
							? 'null (not yet on blockchain)'
							: `"${lastOnChainState}"`;

					// Throw structured error that's business-focused
					throw new NodeOperationError(
						this.getNode(),
						`Payment timeout: Job ${jobId} awaiting payment`,
						{
							description: `Payment polling expired. Last blockchain state: ${stateDisplay}. Job remains in awaiting_payment status.`,
							itemIndex: 0,
						},
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							success: false,
							jobId: jobId,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
