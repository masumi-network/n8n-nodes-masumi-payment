import {
	handleWebhookRequest,
	prepareStartJobData,
	prepareStatusData,
	prepareAvailabilityData,
	prepareInputSchemaData,
} from './webhook-handler';
import { TriggerContext, WebhookRequest } from '../../shared/types';

describe('webhook-handler', () => {
	const mockContext: TriggerContext = {
		_triggerType: 'test',
		_httpMethod: 'POST',
		_timestamp: '2023-01-01T00:00:00.000Z',
	};

	describe('handleWebhookRequest', () => {
		it('should prepare start_job data correctly', () => {
			const request: WebhookRequest = {
				endpoint: 'start_job',
				body: {
					identifier_from_purchaser: 'test-id',
					input_data: [
						{ key: 'prompt', value: 'test prompt' },
						{ key: 'tone', value: 'friendly' },
					],
				},
				query: {},
				headers: {},
				method: 'POST',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json._triggerType).toBe('start_job');
			expect(result.json._httpMethod).toBe('POST');
			expect(result.json.identifier_from_purchaser).toBe('test-id');
			expect(result.json.input_data).toEqual({ 
				prompt: 'test prompt',
				tone: 'friendly'
			});
			expect(result.json._timestamp).toBeDefined();
		});
		
		it('should validate required fields for start_job', () => {
			const request: WebhookRequest = {
				endpoint: 'start_job',
				body: {},
				query: {},
				headers: {},
				method: 'POST',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json.error).toBe('invalid_input');
			expect(result.json.message).toBe('Missing required fields: identifier_from_purchaser, input_data');
		});

		it('should prepare status data correctly', () => {
			const request: WebhookRequest = {
				endpoint: 'status',
				body: {},
				query: { job_id: 'test-job-123' },
				headers: {},
				method: 'GET',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json._triggerType).toBe('status');
			expect(result.json._httpMethod).toBe('GET');
			expect(result.json.job_id).toBe('test-job-123');
		});

		it('should validate job_id for status endpoint', () => {
			const request: WebhookRequest = {
				endpoint: 'status',
				body: {},
				query: {},
				headers: {},
				method: 'GET',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json.error).toBe('missing_job_id');
			expect(result.json.message).toBe('job_id query parameter is required');
		});

		it('should prepare availability data correctly', () => {
			const request: WebhookRequest = {
				endpoint: 'availability',
				body: {},
				query: {},
				headers: {},
				method: 'GET',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json._triggerType).toBe('availability');
			expect(result.json._httpMethod).toBe('GET');
			expect(result.json._timestamp).toBeDefined();
		});

		it('should prepare input_schema data correctly', () => {
			const request: WebhookRequest = {
				endpoint: 'input_schema',
				body: {},
				query: {},
				headers: {},
				method: 'GET',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json._triggerType).toBe('input_schema');
			expect(result.json._httpMethod).toBe('GET');
			expect(result.json._timestamp).toBeDefined();
		});

		it('should prepare start_polling data correctly', () => {
			const request: WebhookRequest = {
				endpoint: 'start_polling',
				body: { job_id: 'test-job-456' },
				query: {},
				headers: {},
				method: 'POST',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json._triggerType).toBe('start_polling');
			expect(result.json._httpMethod).toBe('POST');
			expect(result.json.job_id).toBe('test-job-456');
			expect(result.json._internal).toBe(true);
		});

		it('should validate job_id for start_polling endpoint', () => {
			const request: WebhookRequest = {
				endpoint: 'start_polling',
				body: {},
				query: {},
				headers: {},
				method: 'POST',
			};
			
			const result = handleWebhookRequest(request);
			
			expect(result.json.error).toBe('missing_job_id');
			expect(result.json.message).toBe('job_id is required for polling trigger');
		});

		it('should throw error for unknown endpoint', () => {
			const request: WebhookRequest = {
				endpoint: 'unknown',
				body: {},
				query: {},
				headers: {},
				method: 'GET',
			};
			
			expect(() => handleWebhookRequest(request)).toThrow('Unknown endpoint: unknown');
		});
	});

	describe('prepareStartJobData', () => {
		it('should parse input_data array correctly', () => {
			const body = {
				identifier_from_purchaser: 'test-id',
				input_data: [
					{ key: 'prompt', value: 'test prompt' },
					{ key: 'tone', value: 'neutral' },
					{ key: 'max_length', value: 1000 },
				],
			};

			const result = prepareStartJobData(body, mockContext);

			expect(result.json.input_data).toEqual({
				prompt: 'test prompt',
				tone: 'neutral',
				max_length: 1000,
			});
		});

		it('should handle empty input_data array', () => {
			const body = {
				identifier_from_purchaser: 'test-id',
				input_data: [],
			};

			const result = prepareStartJobData(body, mockContext);

			expect(result.json.input_data).toEqual({});
		});

		it('should handle malformed input_data items', () => {
			const body = {
				identifier_from_purchaser: 'test-id',
				input_data: [
					{ key: 'prompt', value: 'test prompt' },
					{ value: 'no key' }, // missing key
					null, // null item
					{ key: '', value: 'empty key' }, // empty key
				],
			};

			const result = prepareStartJobData(body, mockContext);

			expect(result.json.input_data).toEqual({
				prompt: 'test prompt',
			});
		});
	});

	describe('prepareStatusData', () => {
		it('should extract job_id from query', () => {
			const query = { job_id: 'test-123', other_param: 'ignored' };
			
			const result = prepareStatusData(query, mockContext);
			
			expect(result.json.job_id).toBe('test-123');
			expect(result.json.other_param).toBeUndefined();
		});

		it('should handle missing job_id', () => {
			const query = { other_param: 'value' };
			
			const result = prepareStatusData(query, mockContext);
			
			expect(result.json.error).toBe('missing_job_id');
		});

		it('should handle empty job_id', () => {
			const query = { job_id: '' };
			
			const result = prepareStatusData(query, mockContext);
			
			expect(result.json.error).toBe('missing_job_id');
		});
	});

	describe('prepareAvailabilityData', () => {
		it('should return context with MIP-003 availability response', () => {
			const result = prepareAvailabilityData(mockContext);
			
			expect(result.json._triggerType).toBe('test');
			expect(result.json._httpMethod).toBe('POST');
			expect(result.json._timestamp).toBe('2023-01-01T00:00:00.000Z');
			expect(result.json.status).toBe('available');
			expect(result.json.type).toBe('masumi-agent');
			expect(result.json.message).toBe('Masumi Paywall Service is ready to accept jobs');
		});
	});

	describe('prepareInputSchemaData', () => {
		it('should return context with MIP-003 input schema response', () => {
			const result = prepareInputSchemaData(mockContext);
			
			expect(result.json._triggerType).toBe('test');
			expect(result.json._httpMethod).toBe('POST');
			expect(result.json._timestamp).toBe('2023-01-01T00:00:00.000Z');
			expect(result.json.input_data).toBeDefined();
			expect(Array.isArray(result.json.input_data)).toBe(true);
			expect(result.json.input_data).toHaveLength(2);
			expect(result.json.input_data[0].id).toBe('identifier_from_purchaser');
			expect(result.json.input_data[1].id).toBe('input_data');
		});
	});
});