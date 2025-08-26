import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { updateJobStatus, getJob, storeJob } from '../MasumiPaywall/job-handler';
import { JobStorage, JobStatus, VALID_JOB_STATUSES, Job } from '../../shared/types';
import {
	generateInputHash,
	generateIdentifier,
	createPayment,
	type MasumiConfig,
} from '../MasumiPaywall/create-payment';

// Import package.json to get version automatically
const packageJson = require('../../../package.json');

export class MasumiPaywallRespond implements INodeType {
	description: INodeTypeDescription = {
		displayName: `Masumi Paywall Respond v${packageJson.version}`,
		name: 'masumiPaywallRespond',
		icon: 'file:masumi-respond-logo.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Handle job status updates and webhook responses for Masumi Paywall',
		defaults: {
			name: 'Masumi Respond',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'masumiPaywallApi',
				required: false,
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['start_job', 'status'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Update Status',
						value: 'updateStatus',
						description: 'Update job status after processing',
						action: 'Update job status',
					},
					{
						name: 'Respond to Webhook',
						value: 'respond',
						description: 'Send custom response to webhook',
						action: 'Respond to webhook',
					},
				],
				default: 'respond',
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: false,
				displayOptions: {
					show: {
						operation: ['updateStatus'],
					},
				},
				default: '={{$json.job_id}}',
				placeholder: 'Leave empty to use the last created/accessed job',
				description:
					'ID of the job to update. If empty, uses the last job from this workflow.',
			},
			// fields for respond operation
			{
				displayName: 'Response Type',
				name: 'responseType',
				type: 'options',
				options: [
					{
						name: 'Availability Response',
						value: 'availability',
						description: 'MIP-003 compliant availability response',
					},
					{
						name: 'Input Schema Response',
						value: 'input_schema',
						description: 'MIP-003 compliant input schema response',
					},
					{
						name: 'Start Job Response',
						value: 'start_job',
						description: 'MIP-003 compliant start_job response with payment creation',
					},
					{
						name: 'Status Response',
						value: 'status',
						description: 'MIP-003 compliant status response for job checking',
					},
					{
						name: 'Custom JSON',
						value: 'custom',
						description: 'Custom JSON response',
					},
				],
				displayOptions: {
					show: {
						operation: ['respond'],
					},
				},
				default: 'availability',
				description: 'Type of response to send',
			},
			{
				displayName: 'Custom Response',
				name: 'customResponse',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['custom'],
					},
				},
				default: '{"status": "success"}',
				description: 'Custom JSON response to send',
			},
			// availability response configuration fields
			{
				displayName: 'Status',
				name: 'availabilityStatus',
				type: 'options',
				options: [
					{
						name: 'Available',
						value: 'available',
					},
					{
						name: 'Unavailable',
						value: 'unavailable',
					},
				],
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['availability'],
					},
				},
				default: 'available',
				description: 'Current availability status of the service',
			},
			{
				displayName: 'Type',
				name: 'availabilityType',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['availability'],
					},
				},
				default: 'masumi-agent',
				placeholder: 'masumi-agent',
				description: 'Agent type identifier',
			},
			{
				displayName: 'Message',
				name: 'availabilityMessage',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['availability'],
					},
				},
				default: 'Masumi Paywall Service is ready to accept jobs',
				placeholder: 'Masumi Paywall Service is ready to accept jobs',
				description: 'Status message describing the service availability',
			},
			// input schema configuration field
			{
				displayName: 'Input Schema JSON',
				name: 'inputSchemaJson',
				type: 'json',
				typeOptions: {
					rows: 15,
				},
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['input_schema'],
					},
				},
				default: `{
  "input_data": [
    {
      "id": "full_name",
      "type": "string",
      "name": "Full Name"
    },
    {
      "id": "email",
      "type": "string",
      "name": "Email Address",
      "validations": [
        {
          "validation": "format",
          "value": "email"
        }
      ]
    },
    {
      "id": "job_history",
      "type": "string",
      "name": "Job History",
      "data": {
        "description": "List jobs with title, company, and duration"
      }
    },
    {
      "id": "design_style",
      "type": "option",
      "name": "Design Style",
      "data": {
        "values": ["Modern", "Classic", "Minimalist"]
      },
      "validations": [
        {
          "validation": "min",
          "value": "1"
        },
        {
          "validation": "max",
          "value": "1"
        }
      ]
    }
  ]
}`,
				validateType: 'object',
				ignoreValidationDuringExecution: true,
				description:
					'MIP-003 compliant input schema definition. Feel free to override this fully. More information: https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md#retrieve-input-schema',
			},
			{
				displayName:
					'Feel free to override this fully. <a href="https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md#retrieve-input-schema" target="_blank">More information</a>',
				name: 'inputSchemaNotice',
				type: 'notice',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['input_schema'],
					},
				},
				default: '',
			},
			// start_job response configuration fields
			{
				displayName: 'Input Data',
				name: 'startJobInputData',
				type: 'json',
				typeOptions: {
					rows: 8,
				},
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['start_job'],
					},
				},
				default: '={{$json.input_data}}',
				description: 'Input data received from the job request',
			},
			{
				displayName: 'Identifier from Purchaser',
				name: 'identifierFromPurchaser',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['start_job'],
					},
				},
				default: '={{$json.identifier_from_purchaser}}',
				description: 'Identifier provided by the purchaser',
			},
			// status response configuration field
			{
				displayName: 'Job ID',
				name: 'statusJobId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['respond'],
						responseType: ['status'],
					},
				},
				default: '={{$json.job_id}}',
				description: 'ID of the job to check status for',
			},
			// fields for updateStatus operation
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{
						name: 'pending',
						value: 'pending',
						description: 'Job submitted, payment has not yet created',
					},
					{
						name: 'awaiting_payment',
						value: 'awaiting_payment',
						description: 'Job submitted, waiting for payment confirmation',
					},
					{
						name: 'awaiting_input',
						value: 'awaiting_input',
						description: 'Job waiting for additional input from user',
					},
					{
						name: 'running',
						value: 'running',
						description: 'Job is being processed by the agent',
					},
					{
						name: 'completed',
						value: 'completed',
						description: 'Job completed successfully, results ready',
					},
					{
						name: 'failed',
						value: 'failed',
						description: 'Job encountered an error and could not complete',
					},
				],
				required: true,
				displayOptions: {
					show: {
						operation: ['updateStatus'],
					},
				},
				default: 'completed',
				description: 'New status for the job',
			},
			{
				displayName: 'Result Data',
				name: 'result',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['updateStatus'],
						status: ['completed'],
					},
				},
				default: '={{$json}}',
				description: 'Result data to store with the job',
			},
			{
				displayName: 'Error Message',
				name: 'error',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['updateStatus'],
						status: ['failed'],
					},
				},
				default: '',
				description: 'Error message for failed jobs',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operation = this.getNodeParameter('operation', 0) as string;

		// Debug logging for Railway troubleshooting
		console.log('=== MASUMI RESPOND DEBUG ===');
		console.log('Operation:', operation);
		console.log('Input items count:', items.length);
		console.log('Input data preview:', JSON.stringify(items.slice(0, 2), null, 2));

		for (let i = 0; i < items.length; i++) {
			try {
				// respond operation doesn't need jobId (except for start_job)
				if (operation === 'respond') {
					const responseType = this.getNodeParameter('responseType', i) as string;

					let responseData: any;

					if (responseType === 'start_job') {
						// Handle start_job response - create payment and return MIP-003 compliant response
						try {
							const credentials = await this.getCredentials('masumiPaywallApi');
							const inputData = this.getNodeParameter('startJobInputData', i);
							const identifierFromPurchaser = this.getNodeParameter(
								'identifierFromPurchaser',
								i,
							) as string;

							// Parse input data if it's a string
							let parsedInputData: any;
							try {
								parsedInputData =
									typeof inputData === 'string'
										? JSON.parse(inputData)
										: inputData;
							} catch {
								parsedInputData = inputData;
							}

							// Generate job ID and prepare payment data
							const jobId = generateIdentifier();
							const inputHash = generateInputHash(parsedInputData);

							// Convert identifierFromPurchaser to hex using Buffer (safer for special chars)
							// Ensures proper encoding and length constraints (14-26 chars per MIP-003)
							let hexString = Buffer.from(identifierFromPurchaser, 'utf8').toString(
								'hex',
							);

							// Pad to minimum 14 chars if needed
							if (hexString.length < 14) {
								hexString = hexString.padEnd(14, '0');
							}
							// Truncate to maximum 26 chars if needed
							if (hexString.length > 26) {
								hexString = hexString.substring(0, 26);
							}

							const paymentIdentifier = hexString;

							const paymentData = {
								identifierFromPurchaser: paymentIdentifier,
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
							const storage: JobStorage = this.getWorkflowStaticData('global');
							const job: Job = {
								job_id: jobId,
								identifier_from_purchaser: paymentIdentifier, // Use hex-converted identifier
								input_data: parsedInputData,
								status: 'awaiting_payment',
								payment: {
									blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
									payByTime: paymentResponse.data.payByTime,
									submitResultTime: paymentResponse.data.submitResultTime,
									unlockTime: paymentResponse.data.unlockTime,
									externalDisputeUnlockTime:
										paymentResponse.data.externalDisputeUnlockTime,
									inputHash: inputHash,
								},
								created_at: new Date().toISOString(),
								updated_at: new Date().toISOString(),
							};

							storeJob(storage, jobId, job);

							// Track last job_id for convenience in updateStatus operations
							storage.last_job_id = jobId;

							// Trigger internal payment polling workflow - deployment-agnostic approach
							const item = this.getInputData()[i];
							const instanceUrl = (item?.json as any)?._instanceUrl || '';
							const customPath = (item?.json as any)?._webhookPath || '';

							console.log(
								`[MasumiRespond] Instance URL: ${instanceUrl || 'not available'}`,
							);
							console.log(`[MasumiRespond] Custom path: ${customPath || 'none'}`);

							if (!instanceUrl) {
								console.error(
									'[MasumiRespond] No instance URL available - cannot trigger internal webhook',
								);
								console.error(
									'[MasumiRespond] This indicates an issue with webhook context passing',
								);
								// Still create the payment response, but note the internal trigger failure
								responseData._internal_webhook_error = 'No instance URL available';
							} else {
								// Construct the polling URL using the actual instance URL
								const pathSegment = customPath ? `/${customPath}` : '';
								const pollingUrl = `${instanceUrl}/webhook${pathSegment}/start_polling`;

								console.log(
									`[MasumiRespond] Triggering internal webhook: ${pollingUrl}`,
								);

								try {
									const response = await fetch(pollingUrl, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ job_id: jobId }),
									});

									if (!response.ok) {
										const text = await response.text();
										console.error(
											`[MasumiRespond] Internal webhook failed: ${response.status} - ${text}`,
										);
										responseData._internal_webhook_error = `Failed: ${response.status}`;
									} else {
										console.log(
											`[MasumiRespond] Internal webhook triggered successfully`,
										);
										responseData._internal_webhook_triggered = true;
									}
								} catch (error) {
									console.error(`[MasumiRespond] Internal webhook error:`, error);
									responseData._internal_webhook_error = (error as Error).message;
								}
							}

							// Create MIP-003 compliant start_job response
							responseData = {
								status: 'success',
								job_id: jobId,
								blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
								paybytime: paymentResponse.data.payByTime
									? Math.floor(parseInt(paymentResponse.data.payByTime) / 1000)
									: undefined,
								submitResultTime: paymentResponse.data.submitResultTime
									? Math.floor(
											parseInt(paymentResponse.data.submitResultTime) / 1000,
										)
									: undefined,
								unlockTime: paymentResponse.data.unlockTime
									? Math.floor(parseInt(paymentResponse.data.unlockTime) / 1000)
									: undefined,
								externalDisputeUnlockTime: paymentResponse.data
									.externalDisputeUnlockTime
									? Math.floor(
											parseInt(
												paymentResponse.data.externalDisputeUnlockTime,
											) / 1000,
										)
									: undefined,
								agentIdentifier: config.agentIdentifier,
								sellerVKey: config.sellerVkey,
								identifierFromPurchaser: paymentIdentifier, // Return hex-converted identifier
								amounts: paymentResponse.data.RequestedFunds || [
									{
										amount: 3000000,
										unit: 'lovelace',
									},
								],
								input_hash: inputHash,
							};
						} catch (error) {
							// Return error response for failed job creation
							responseData = {
								error: 'job_creation_failed',
								message: `Failed to create job: ${error instanceof Error ? error.message : String(error)}`,
							};
						}
					} else if (responseType === 'status') {
						// Handle status response - check job status and return MIP-003 compliant response
						try {
							const credentials = await this.getCredentials('masumiPaywallApi');
							const jobId = items[i].json.job_id as string;

							if (!jobId) {
								responseData = {
									error: 'missing_job_id',
									message: 'job_id is required for status requests',
								};
							} else {
								// Get job from workflow static data
								const storage: JobStorage = this.getWorkflowStaticData('global');
								const job = getJob(storage, jobId);

								if (!job) {
									responseData = {
										job_id: jobId,
										status: 'failed',
										message: 'Job not found',
									};
								} else {
									// Track last accessed job_id
									storage.last_job_id = jobId;
									// Check if we need to poll payment status for awaiting_payment jobs
									if (
										job.status === 'awaiting_payment' &&
										job.payment?.blockchainIdentifier
									) {
										const config: MasumiConfig = {
											paymentServiceUrl:
												credentials.paymentServiceUrl as string,
											apiKey: credentials.apiKey as string,
											agentIdentifier: credentials.agentIdentifier as string,
											network: credentials.network as string,
											sellerVkey: credentials.sellerVkey as string,
										};

										// Import pollPaymentStatus for checking current payment state
										const { pollPaymentStatus } = await import(
											'../MasumiPaywall/check-payment-status'
										);
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
									responseData = {
										job_id: jobId,
										status: job.status,
									};

									// Add optional fields based on job state
									if (job.payment?.payByTime) {
										const parsed = parseInt(job.payment.payByTime);
										if (!isNaN(parsed)) {
											responseData.paybytime = Math.floor(parsed / 1000);
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
										responseData.message =
											'Waiting for payment confirmation on blockchain';
									} else if (job.status === 'running') {
										responseData.message = 'Job is being processed';
									} else if (job.status === 'completed') {
										responseData.message = 'Job completed successfully';
									}
								}
							}
						} catch (error) {
							// Return error response for failed status check
							responseData = {
								error: 'status_check_failed',
								message: `Failed to check job status: ${error instanceof Error ? error.message : String(error)}`,
							};
						}
					} else if (responseType === 'availability') {
						const status = this.getNodeParameter('availabilityStatus', i) as string;
						const type = this.getNodeParameter('availabilityType', i) as string;
						const message = this.getNodeParameter('availabilityMessage', i) as string;

						responseData = {
							status: status,
							type: type,
							message: message,
						};
					} else if (responseType === 'input_schema') {
						const inputSchemaJson = this.getNodeParameter(
							'inputSchemaJson',
							i,
						) as string;
						try {
							responseData = JSON.parse(inputSchemaJson);
						} catch {
							throw new NodeOperationError(
								this.getNode(),
								'Invalid JSON in input schema',
							);
						}
					} else if (responseType === 'custom') {
						const customResponse = this.getNodeParameter('customResponse', i) as string;
						try {
							responseData = JSON.parse(customResponse);
						} catch {
							throw new NodeOperationError(
								this.getNode(),
								'Invalid JSON in custom response',
							);
						}
					}

					// Use n8n's webhook response mechanism like RespondToWebhook node
					const response = {
						body: responseData,
						headers: {
							'Content-Type': 'application/json',
						},
						statusCode: 200,
					};

					// Send the HTTP response back to webhook caller
					this.sendResponse(response);

					returnData.push({
						json: responseData,
					});

					continue;
				}

				let jobId = this.getNodeParameter('jobId', i) as string;

				const storage: JobStorage = this.getWorkflowStaticData('global');

				// Use last_job_id if no jobId is provided
				if (!jobId && storage.last_job_id) {
					jobId = storage.last_job_id;
				}

				if (!jobId) {
					throw new NodeOperationError(
						this.getNode(),
						'Job ID is required. Either provide a job_id or ensure a job was created/accessed in this workflow.',
					);
				}

				if (operation === 'updateStatus') {
					const status = this.getNodeParameter('status', i) as JobStatus;
					const result =
						status === 'completed' ? this.getNodeParameter('result', i) : undefined;
					const error =
						status === 'failed'
							? (this.getNodeParameter('error', i) as string)
							: undefined;

					// validate status
					if (!VALID_JOB_STATUSES.includes(status)) {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid status value. Must be one of: ${VALID_JOB_STATUSES.join(', ')}`,
						);
					}

					// validate result is provided for completed status
					if (status === 'completed' && !result) {
						throw new NodeOperationError(
							this.getNode(),
							'Result data is required when status is "completed"',
						);
					}

					// update job status
					const updatedJob = updateJobStatus(storage, jobId, status, result, error);

					if (!updatedJob) {
						throw new NodeOperationError(this.getNode(), `Job not found: ${jobId}`);
					}

					returnData.push({
						json: {
							success: true,
							job: updatedJob,
							operation: 'updateStatus',
						},
					});
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
				}
			} catch (error) {
				console.error('=== MASUMI RESPOND ERROR ===');
				console.error('Operation:', operation);
				console.error('Item index:', i);
				console.error('Error details:', error);

				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					returnData.push({
						json: {
							error: errorMessage,
							operation,
							itemIndex: i,
							timestamp: new Date().toISOString(),
							debug: 'Check Railway logs for detailed error information',
						},
					});
					continue;
				}

				// Enhanced error with context for better debugging
				const contextualError = new Error(
					`Masumi ${operation} operation failed (item ${i}): ${error instanceof Error ? error.message : String(error)}`,
				);
				contextualError.stack = error instanceof Error ? error.stack : undefined;
				throw contextualError;
			}
		}

		return [returnData];
	}
}
