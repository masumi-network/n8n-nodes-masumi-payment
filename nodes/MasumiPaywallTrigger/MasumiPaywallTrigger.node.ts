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
		inputs: [], // no inputs - it's a trigger
		outputs: ['main'],
		credentials: [
			{
				name: 'masumiPaywallApi',
				required: false, // optional for read-only endpoints
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
						name: 'Check Availability',
						value: 'availability',
						description: 'GET /availability - Service health check',
					},
					{
						name: 'Check Status',
						value: 'status',
						description: 'GET /status - Check job status',
					},
					{
						name: 'Get Input Schema',
						value: 'input_schema',
						description: 'GET /input_schema - Get expected inputs',
					},
					{
						name: 'Start Job',
						value: 'start_job',
						description: 'POST /start_job - Initialize new job',
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
				description:
					'Custom path for the webhook. If empty, uses auto-generated webhook ID. Example: "masumi" creates URLs like /webhook/masumi/availability',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'hidden',
				default:
					'={{($parameter["endpoint"] === "start_job" || $parameter["endpoint"] === "start_polling") ? "POST" : "GET"}}',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'Immediately',
						value: 'onReceived',
						description:
							'Respond immediately with fixed data for availability/input_schema',
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
		const requestUrl = this.getRequestObject().url;
		const method = this.getRequestObject().method;

		// Debug logging for Railway troubleshooting
		console.log('=== MASUMI WEBHOOK DEBUG ===');
		console.log('Configured endpoint:', endpoint);
		console.log('Request URL:', requestUrl);
		console.log('Request method:', method);
		console.log('Webhook path param:', this.getNodeParameter('path', 0));

		try {
			// Extract instance URL from the incoming request for deployment-agnostic webhook calls
			const headers = this.getHeaderData();
			let instanceUrl = '';

			if (requestUrl) {
				if (requestUrl.startsWith('http')) {
					// Full URL like: https://masumi-n8n.up.railway.app/webhook/555/start_job
					const url = new URL(requestUrl);
					instanceUrl = url.origin; // Gets https://masumi-n8n.up.railway.app
				} else if (headers.host) {
					// Relative URL with host header
					const protocol =
						headers['x-forwarded-proto'] ||
						(headers['x-forwarded-ssl'] === 'on' ? 'https' : 'http');
					instanceUrl = `${protocol}://${headers.host}`;
				}
			}

			console.log('Extracted instance URL:', instanceUrl || 'not detected');

			// Fallback: try to detect endpoint from URL path if configured endpoint seems wrong
			let detectedEndpoint = endpoint;
			if (requestUrl) {
				const urlPath = requestUrl.toLowerCase();
				if (urlPath.includes('/availability') && endpoint !== 'availability') {
					console.log('URL-based endpoint detection: availability');
					detectedEndpoint = 'availability';
				} else if (urlPath.includes('/status') && endpoint !== 'status') {
					console.log('URL-based endpoint detection: status');
					detectedEndpoint = 'status';
				} else if (urlPath.includes('/input_schema') && endpoint !== 'input_schema') {
					console.log('URL-based endpoint detection: input_schema');
					detectedEndpoint = 'input_schema';
				} else if (urlPath.includes('/start_job') && endpoint !== 'start_job') {
					console.log('URL-based endpoint detection: start_job');
					detectedEndpoint = 'start_job';
				} else if (urlPath.includes('/start_polling') && endpoint !== 'start_polling') {
					console.log('URL-based endpoint detection: start_polling');
					detectedEndpoint = 'start_polling';
				}
			}

			console.log('Using endpoint:', detectedEndpoint);

			// Simple: just process the request and pass it to the respond node
			const result = handleWebhookRequest({
				endpoint: detectedEndpoint,
				body: this.getBodyData(),
				query: this.getQueryData(),
				headers: this.getHeaderData(),
				method: method,
				path: this.getNodeParameter('path', 0) as string,
				instanceUrl: instanceUrl,
			});

			console.log('Webhook result:', JSON.stringify(result, null, 2));

			// Always pass data through workflow - let respond node handle the response
			return {
				workflowData: [[result]],
			};
		} catch (error) {
			console.error('Webhook error:', error);

			// Handle webhook errors gracefully
			const errorResult = {
				json: {
					endpoint,
					error: 'webhook_error',
					message: (error as Error).message,
					requestUrl,
					method,
					timestamp: new Date().toISOString(),
					debug: {
						webhookPath: this.getNodeParameter('path', 0),
						headers: this.getHeaderData(),
						query: this.getQueryData(),
					},
				},
			};

			console.log('Error result:', JSON.stringify(errorResult, null, 2));

			return {
				workflowData: [[errorResult]],
			};
		}
	}
}
