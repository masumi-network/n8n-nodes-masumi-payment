import { createHash } from 'crypto';

/**
 * Helper function to generate input hash from data
 * Format: sha256(identifierFromPurchaser;inputString)
 */
export function generateInputHash(identifierFromPurchaser: string, inputData: any): string {
	const inputString = JSON.stringify(inputData);
	const hashInput = `${identifierFromPurchaser};${inputString}`;
	return createHash('sha256').update(hashInput).digest('hex');
}