/**
 * Input schema response handler for Masumi paywall respond node
 */

export interface InputSchemaResult {
	responseData: any;
	success: boolean;
	error?: string;
}

/**
 * Handles input_schema endpoint responses
 * Returns MIP-003 compliant input schema definition
 */
export async function handleInputSchema(schemaJson: string): Promise<InputSchemaResult> {
	try {
		const responseData = JSON.parse(schemaJson);
		return {
			responseData,
			success: true,
		};
	} catch (error) {
		return {
			responseData: { error: 'Invalid JSON in input schema' },
			success: false,
			error: 'Invalid JSON in input schema',
		};
	}
}
