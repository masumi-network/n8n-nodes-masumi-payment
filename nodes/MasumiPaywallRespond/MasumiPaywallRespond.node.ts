import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { updateJobStatus, getJob } from '../MasumiPaywall/job-handler';
import { JobStorage, JobStatus, VALID_JOB_STATUSES } from '../../shared/types';

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
		credentials: [],
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
						name: 'Get Job',
						value: 'getJob',
						description: 'Get job information by ID',
						action: 'Get job information',
					},
					{
						name: 'Respond to Webhook',
						value: 'respond',
						description: 'Send custom response to webhook',
						action: 'Respond to webhook',
					},
				],
				default: 'updateStatus',
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						operation: ['updateStatus', 'getJob'],
					},
				},
				default: '={{$json.job_id}}',
				description: 'ID of the job to update or retrieve',
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
			// fields for updateStatus operation
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{
						name: 'Processing',
						value: 'processing',
					},
					{
						name: 'Done',
						value: 'done',
					},
					{
						name: 'Failed',
						value: 'failed',
					},
				],
				required: true,
				displayOptions: {
					show: {
						operation: ['updateStatus'],
					},
				},
				default: 'done',
				description: 'New status for the job',
			},
			{
				displayName: 'Result Data',
				name: 'result',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['updateStatus'],
						status: ['done'],
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

		for (let i = 0; i < items.length; i++) {
			try {
				// respond operation doesn't need jobId
				if (operation === 'respond') {
					const responseType = this.getNodeParameter('responseType', i) as string;
					
					let responseData: any;
					
					if (responseType === 'availability') {
						responseData = {
							status: 'available',
							type: 'masumi-agent',
							message: 'Masumi Paywall Service is ready to accept jobs',
						};
					} else if (responseType === 'input_schema') {
						responseData = {
							input_data: [
								{
									id: 'identifier_from_purchaser',
									type: 'string',
									name: 'Job Identifier',
									data: {
										description: 'Your custom identifier for tracking this job',
										placeholder: 'my-job-123',
									},
								},
								{
									id: 'input_data',
									type: 'object',
									name: 'Input Data',
									data: {
										description: 'Data to be processed by the service',
									},
								},
							],
						};
					} else if (responseType === 'custom') {
						const customResponse = this.getNodeParameter('customResponse', i) as string;
						try {
							responseData = JSON.parse(customResponse);
						} catch {
							throw new NodeOperationError(this.getNode(), 'Invalid JSON in custom response');
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

				const jobId = this.getNodeParameter('jobId', i) as string;

				if (!jobId) {
					throw new NodeOperationError(this.getNode(), 'Job ID is required');
				}

				const storage: JobStorage = this.getWorkflowStaticData('global');

				if (operation === 'updateStatus') {
					const status = this.getNodeParameter('status', i) as JobStatus;
					const result = status === 'done' ? this.getNodeParameter('result', i) : undefined;
					const error = status === 'failed' ? this.getNodeParameter('error', i) as string : undefined;

					// validate status
					if (!VALID_JOB_STATUSES.includes(status)) {
						throw new NodeOperationError(this.getNode(), `Invalid status value. Must be one of: ${VALID_JOB_STATUSES.join(', ')}`);
					}

					// validate result is provided for done status
					if (status === 'done' && !result) {
						throw new NodeOperationError(this.getNode(), 'Result data is required when status is "done"');
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
				} else if (operation === 'getJob') {
					// get job information
					const job = getJob(storage, jobId);

					if (!job) {
						throw new NodeOperationError(this.getNode(), `Job not found: ${jobId}`);
					}

					returnData.push({
						json: {
							...job,
							operation: 'getJob',
						},
					});
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
							operation,
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