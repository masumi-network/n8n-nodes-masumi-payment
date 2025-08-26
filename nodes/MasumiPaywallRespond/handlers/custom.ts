/**
 * Custom response handler for Masumi paywall respond node
 */

export interface CustomResult {
	responseData: any;
	success: boolean;
	error?: string;
}

/**
 * Handles custom JSON response
 */
export async function handleCustomResponse(customJson: string): Promise<CustomResult> {
	try {
		const responseData = JSON.parse(customJson);
		return {
			responseData,
			success: true,
		};
	} catch (error) {
		return {
			responseData: { error: 'Invalid JSON in custom response' },
			success: false,
			error: 'Invalid JSON in custom response',
		};
	}
}
