export interface TriggerContext {
	_triggerType: string;
	_httpMethod: string;
	_timestamp: string;
}

export interface WebhookRequest {
	endpoint: string;
	body: any;
	query: any;
	headers: any;
	method: string;
}

export type JobStatus = 'pending' | 'awaiting_payment' | 'awaiting_input' | 'running' | 'completed' | 'failed';

export const VALID_JOB_STATUSES: JobStatus[] = ['pending', 'awaiting_payment', 'awaiting_input', 'running', 'completed', 'failed'];

export interface Job {
	job_id: string;
	identifier_from_purchaser: string;
	input_data: Record<string, any>;
	status: JobStatus;
	payment?: {
		blockchainIdentifier: string;
		payByTime: string;
		submitResultTime: string;
		unlockTime: string;
		externalDisputeUnlockTime: string;
		inputHash: string;
	};
	result?: any;
	error?: string;
	created_at: string;
	updated_at: string;
}

export interface JobStorage {
	jobs?: Record<string, Job>;
	last_job_id?: string;
}

// request/response type definitions
export interface StartJobRequestBody {
	identifier_from_purchaser: string;
	input_data: Array<{ key: string; value: any }>;
}

export interface StatusQuery {
	job_id: string;
}

export interface StartJobResponse {
	_triggerType: string;
	_httpMethod: string;
	_timestamp: string;
	identifier_from_purchaser: string;
	input_data: Record<string, any>;
	raw_body: StartJobRequestBody;
}

export interface StatusResponse {
	_triggerType: string;
	_httpMethod: string;
	_timestamp: string;
	job_id: string;
}

export interface ErrorResponse {
	_triggerType: string;
	_httpMethod: string;
	_timestamp: string;
	error: string;
	message: string;
}