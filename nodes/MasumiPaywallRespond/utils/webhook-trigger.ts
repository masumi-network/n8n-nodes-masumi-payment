/**
 * Internal webhook trigger utility for Masumi paywall
 * Handles triggering the start_polling endpoint after job creation
 */

export interface WebhookTriggerResult {
	success: boolean;
	error?: string;
	statusCode?: number;
}

export interface WebhookTriggerOptions {
	instanceUrl: string;
	webhookPath: string;
	jobId: string;
	job?: any; // Optional job data to pass instead of requiring storage lookup
}

/**
 * Triggers the internal start_polling webhook endpoint
 * This function is isolated for testing and debugging
 */
export async function triggerInternalWebhook({
	instanceUrl,
	webhookPath,
	jobId,
	job,
}: WebhookTriggerOptions): Promise<WebhookTriggerResult> {
	console.log('[WebhookTrigger] Starting trigger attempt');
	console.log('[WebhookTrigger] Instance URL:', instanceUrl || 'not provided');
	console.log('[WebhookTrigger] Webhook Path:', webhookPath || 'not provided');
	console.log('[WebhookTrigger] Job ID:', jobId || 'not provided');

	// Validate required parameters
	if (!instanceUrl) {
		console.error('[WebhookTrigger] Missing instance URL - cannot proceed');
		return { success: false, error: 'No instance URL provided' };
	}

	if (!jobId) {
		console.error('[WebhookTrigger] Missing job ID - cannot proceed');
		return { success: false, error: 'No job ID provided' };
	}

	// Construct the polling URL
	const pathSegment = webhookPath ? `/${webhookPath}` : '';
	const pollingUrl = `${instanceUrl}/webhook${pathSegment}/start_polling`;

	console.log('[WebhookTrigger] Constructed URL:', pollingUrl);

	try {
		console.log('[WebhookTrigger] Making HTTP POST request...');
		const response = await fetch(pollingUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				job_id: jobId,
				job_data: job, // Include complete job data to avoid storage lookup
			}),
		});

		console.log('[WebhookTrigger] Response status:', response.status);
		console.log('[WebhookTrigger] Response ok:', response.ok);

		if (!response.ok) {
			const text = await response.text();
			console.error(
				`[WebhookTrigger] HTTP error ${response.status}:`,
				text.substring(0, 200),
			);
			return {
				success: false,
				error: `HTTP ${response.status}: ${text.substring(0, 100)}`,
				statusCode: response.status,
			};
		}

		console.log('[WebhookTrigger] Internal webhook triggered successfully!');
		return { success: true, statusCode: response.status };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error('[WebhookTrigger] Exception during fetch:', errorMessage);
		return { success: false, error: errorMessage };
	}
}

/**
 * Helper function to extract trigger context from n8n input data
 */
export function extractTriggerContext(inputData: any): {
	instanceUrl: string;
	webhookPath: string;
} {
	const instanceUrl = inputData?._instanceUrl || '';
	const webhookPath = inputData?._webhookPath || '';

	console.log('[WebhookTrigger] Extracted context:');
	console.log('  - Instance URL:', instanceUrl || 'missing');
	console.log('  - Webhook Path:', webhookPath || 'missing');

	return { instanceUrl, webhookPath };
}
