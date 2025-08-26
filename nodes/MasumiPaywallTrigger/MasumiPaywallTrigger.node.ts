import {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { handleWebhookRequest } from './webhook-handler';

// Import package.json to get version automatically
const packageJson = require('../../../package.json');

export class MasumiPaywallTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: `Masumi Paywall Trigger v${packageJson.version}`,
		name: 'masumiPaywallTrigger',
		icon: 'file:masumi-trigger-logo.svg',
		group: ['trigger'],
		version: 1,
		description: 'Triggers workflow via Masumi REST endpoints',
		defaults: {
			name: 'Masumi Trigger',
		},
		inputs: [],  // no inputs - it's a trigger
		outputs: ['main'],
		credentials: [
			{
				name: 'masumiPaywallApi',
				required: false,  // optional for read-only endpoints
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				isFullPath: true,
				path: '={{$parameter["path"] ? $parameter["path"] + "/" + $parameter["endpoint"] : $parameter["endpoint"]}}',
			},
		],
		properties: [
			{
				displayName: 'Endpoint',
				name: 'endpoint',
				type: 'options',
				options: [
					{
						name: 'Start Job',
						value: 'start_job',
						description: 'POST /start_job - Initialize new job',
					},
					{
						name: 'Check Status',
						value: 'status',
						description: 'GET /status - Check job status',
					},
					{
						name: 'Check Availability',
						value: 'availability',
						description: 'GET /availability - Service health check',
					},
					{
						name: 'Get Input Schema',
						value: 'input_schema',
						description: 'GET /input_schema - Get expected inputs',
					},
					{
						name: 'Start Polling (Internal)',
						value: 'start_polling',
						description: 'POST /start_polling - Internal trigger for payment polling',
					},
				],
				default: 'start_job',
				required: true,
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'masumi',
				description: 'Custom path for the webhook. If empty, uses auto-generated webhook ID. Example: "masumi" creates URLs like /webhook/masumi/availability',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'hidden',
				default: '={{($parameter["endpoint"] === "start_job" || $parameter["endpoint"] === "start_polling") ? "POST" : "GET"}}',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'Immediately',
						value: 'onReceived',
						description: 'Respond immediately with fixed data for availability/input_schema',
					},
					{
						name: 'When Last Node Finishes',
						value: 'lastNode',
					},
					{
						name: 'Using Respond to Webhook Node',
						value: 'responseNode',
					},
				],
				default: 'responseNode',
				description: 'When to send the response',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const endpoint = this.getNodeParameter('endpoint', 0) as string;
		
		try {
			// Simple: just process the request and pass it to the respond node
			const result = handleWebhookRequest({
				endpoint,
				body: this.getBodyData(),
				query: this.getQueryData(),
				headers: this.getHeaderData(),
				method: this.getRequestObject().method,
			});

			// Always pass data through workflow - let respond node handle the response
			return {
				workflowData: [[result]],
			};
		} catch (error) {
			// Handle webhook errors gracefully
			const errorResult = {
				json: {
					endpoint,
					error: 'webhook_error',
					message: (error as Error).message,
					timestamp: new Date().toISOString(),
				},
			};
			
			return {
				workflowData: [[errorResult]],
			};
		}
	}
}