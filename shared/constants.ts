import { JobStatus } from './types';

/**
 * Job status constants derived from the JobStatus type
 * This ensures single source of truth - no duplication of status values
 */
export const JOB_STATUS = {
	PENDING: 'pending',
	AWAITING_PAYMENT: 'awaiting_payment',
	AWAITING_INPUT: 'awaiting_input',
	RUNNING: 'running',
	COMPLETED: 'completed',
	FAILED: 'failed',
} as const satisfies Record<string, JobStatus>;

/**
 * Array of all valid job statuses derived from JOB_STATUS object
 */
export const VALID_JOB_STATUSES = Object.values(JOB_STATUS) as JobStatus[];

