import { INodeExecutionData } from 'n8n-workflow';
import { TriggerContext, WebhookRequest } from '../../shared/types';

/**
 * handle incoming webhook requests and prepare data for processor
 * testable pure function - no n8n dependencies
 */
export function handleWebhookRequest(request: WebhookRequest): INodeExecutionData {
	const { endpoint, body, query, method, path, instanceUrl } = request;

	// Debug logging for Railway troubleshooting
	console.log('=== WEBHOOK HANDLER DEBUG ===');
	console.log('Endpoint param:', endpoint);
	console.log('Request method:', method);
	console.log('Query params:', query);
	console.log(
		'Body preview:',
		typeof body === 'object' ? JSON.stringify(body).substring(0, 200) : body,
	);

	// create context for processor node
	const context: TriggerContext = {
		_triggerType: endpoint,
		_httpMethod: method,
		_timestamp: new Date().toISOString(),
		_webhookPath: path,
		_instanceUrl: instanceUrl,
	};

	// validate and prepare data based on endpoint
	switch (endpoint) {
		case 'start_job':
			return prepareStartJobData(body, context);
		case 'status':
			return prepareStatusData(query, context);
		case 'availability':
			return prepareAvailabilityData(context);
		case 'input_schema':
			return prepareInputSchemaData(context);
		case 'start_polling':
			return prepareStartPollingData(body, context);
		default:
			throw new Error(`Unknown endpoint: ${endpoint}`);
	}
}

export function prepareStartJobData(body: any, context: TriggerContext): INodeExecutionData {
	// validate required fields
	if (!body?.identifier_from_purchaser || !body?.input_data) {
		return {
			json: {
				...context,
				error: 'invalid_input',
				message: 'Missing required fields: identifier_from_purchaser, input_data',
			},
		};
	}

	// parse input_data array to object
	const inputData: Record<string, any> = {};
	if (Array.isArray(body.input_data)) {
		for (const item of body.input_data) {
			if (item?.key && item.key.trim()) {
				inputData[item.key] = item.value;
			}
		}
	}

	return {
		json: {
			...context,
			identifier_from_purchaser: body.identifier_from_purchaser,
			input_data: inputData,
			raw_body: body,
		},
	};
}

export function prepareStatusData(query: any, context: TriggerContext): INodeExecutionData {
	if (!query?.job_id) {
		return {
			json: {
				...context,
				error: 'missing_job_id',
				message: 'job_id query parameter is required',
			},
		};
	}

	return {
		json: {
			...context,
			job_id: query.job_id,
		},
	};
}

export function prepareAvailabilityData(context: TriggerContext): INodeExecutionData {
	// MIP-003 availability response
	const availabilityResponse = {
		status: 'available',
		type: 'masumi-agent',
		message: 'Masumi Paywall Service is ready to accept jobs',
	};

	return {
		json: {
			...context,
			...availabilityResponse,
		},
	};
}

export function prepareInputSchemaData(context: TriggerContext): INodeExecutionData {
	// MIP-003 input schema response
	const inputSchemaResponse = {
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

	return {
		json: {
			...context,
			...inputSchemaResponse,
		},
	};
}

export function prepareStartPollingData(body: any, context: TriggerContext): INodeExecutionData {
	if (!body?.job_id) {
		return {
			json: {
				...context,
				error: 'missing_job_id',
				message: 'job_id is required for polling trigger',
			},
		};
	}

	return {
		json: {
			...context,
			job_id: body.job_id,
			job_data: body.job_data, // Pass through job data from webhook trigger
			_internal: true, // Mark as internal trigger
		},
	};
}
