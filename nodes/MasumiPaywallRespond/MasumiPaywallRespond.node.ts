import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { updateJobStatus } from '../MasumiPaywall/job-handler';
import { JobStorage, JobStatus, VALID_JOB_STATUSES } from '../../shared/types';
import { JOB_STATUS } from '../../shared/constants';
import { handleStartJob } from './handlers/start-job';
import { handleStatusResponse } from './handlers/status';
import { handleAvailability } from './handlers/availability';
import { handleInputSchema } from './handlers/input-schema';
import { handleCustomResponse } from './handlers/custom';

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
				required: true,
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
						name: 'Custom JSON',
						value: 'custom',
						description: 'Custom JSON response',
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
				displayName: 'Identifier From Purchaser',
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
				default: "completed",
				options: [
					{
						name: 'Awaiting Input',
						value: JOB_STATUS.AWAITING_INPUT,
						description: 'Job waiting for additional input from user',
					},
					{
						name: 'Awaiting Payment',
						value: JOB_STATUS.AWAITING_PAYMENT,
						description: 'Job submitted, waiting for payment confirmation',
					},
					{
						name: 'Completed',
						value: JOB_STATUS.COMPLETED,
						description: 'Job completed successfully, results ready',
					},
					{
						name: 'Failed',
						value: JOB_STATUS.FAILED,
						description: 'Job encountered an error and could not complete',
					},
					{
						name: 'Pending',
						value: JOB_STATUS.PENDING,
						description: 'Job submitted, payment has not yet created',
					},
					{
						name: 'Running',
						value: JOB_STATUS.RUNNING,
						description: 'Job is being processed by the agent',
					},
				],
				required: true,
				displayOptions: {
					show: {
						operation: ['updateStatus'],
					},
				},
				description: 'New status for the job',
			},
			{
				displayName: 'Result Data',
				name: 'result',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['updateStatus'],
						status: [JOB_STATUS.COMPLETED],
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
						status: [JOB_STATUS.FAILED],
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

		for (let i = 0; i < items.length; i++) {
			try {
				// respond operation doesn't need jobId (except for start_job)
				if (operation === 'respond') {
					const responseType = this.getNodeParameter('responseType', i) as string;

					let responseData: any = {};

					if (responseType === 'start_job') {
						// Use the refactored start job handler
						try {
							const credentials = await this.getCredentials('masumiPaywallApi');

							// Get trigger context from input data first
							const item = this.getInputData()[i];
							const triggerContext = item?.json || {};

							// Get input data from trigger context instead of node parameter
							const inputData =
								triggerContext.input_data ||
								this.getNodeParameter('startJobInputData', i);
							const identifierFromPurchaser =
								(triggerContext.identifier_from_purchaser ||
									this.getNodeParameter('identifierFromPurchaser', i)) as string;

							// Get workflow storage
							const storage: JobStorage = this.getWorkflowStaticData('global');

							// Call the refactored handler
							const result = await handleStartJob({
								credentials,
								storage,
								inputData,
								identifierFromPurchaser,
								triggerContext,
							});

							responseData = result.responseData;
						} catch (error) {
							// Return error response for failed job creation
							responseData = {
								error: 'job_creation_failed',
								message: `Failed to create job: ${error instanceof Error ? error.message : String(error)}`,
							};
						}
					} else if (responseType === 'status') {
						try {
							const credentials = await this.getCredentials('masumiPaywallApi');
							const jobId = items[i].json.job_id as string;
							const storage: JobStorage = this.getWorkflowStaticData('global');

							const result = await handleStatusResponse({
								credentials,
								jobId,
								storage,
							});
							responseData = result.responseData;
						} catch (error) {
							responseData = {
								error: 'status_check_failed',
								message: `Failed to check job status: ${error instanceof Error ? error.message : String(error)}`,
							};
						}
					} else if (responseType === 'availability') {
						const status = this.getNodeParameter('availabilityStatus', i) as string;
						const type = this.getNodeParameter('availabilityType', i) as string;
						const message = this.getNodeParameter('availabilityMessage', i) as string;

						const result = await handleAvailability({ status, type, message });
						responseData = result.responseData;
					} else if (responseType === 'input_schema') {
						const inputSchemaJson = this.getNodeParameter(
							'inputSchemaJson',
							i,
						) as string;
						const result = await handleInputSchema(inputSchemaJson);

						if (!result.success) {
							throw new NodeOperationError(
								this.getNode(),
								result.error || 'Invalid JSON in input schema',
							);
						}
						responseData = result.responseData;
					} else if (responseType === 'custom') {
						const customResponse = this.getNodeParameter('customResponse', i) as string;
						const result = await handleCustomResponse(customResponse);

						if (!result.success) {
							throw new NodeOperationError(
								this.getNode(),
								result.error || 'Invalid JSON in custom response',
							);
						}
						responseData = result.responseData;
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
						status === JOB_STATUS.COMPLETED ? this.getNodeParameter('result', i) : undefined;
					const error =
						status === JOB_STATUS.FAILED
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
					if (status === JOB_STATUS.COMPLETED && !result) {
						throw new NodeOperationError(
							this.getNode(),
							'Result data is required when status is "completed"',
						);
					}

					// get credentials for onchain submission
					const credentials = await this.getCredentials('masumiPaywallApi');
					const config = {
						paymentServiceUrl: credentials.paymentServiceUrl as string,
						apiKey: credentials.apiKey as string,
						agentIdentifier: credentials.agentIdentifier as string,
						network: credentials.network as string,
						sellerVkey: credentials.sellerVkey as string,
					};

					// update job status
					const updatedJob = await updateJobStatus(storage, jobId, status, result, error, config);

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
