import { createHash } from 'crypto';
import { canonicalizeEx } from 'json-canonicalize';

/**
 * Helper function to generate input hash from data
 * Format: sha256(identifierFromPurchaser;canonicalizedInputString)
 */
export function generateInputHash(identifierFromPurchaser: string, inputData: any): string {
	const object = typeof inputData === 'object' && inputData !== null ? inputData : Object.fromEntries(inputData);
	const inputString = canonicalizeEx(object, {
		filterUndefined: true,
	});
	const hashInput = `${identifierFromPurchaser};${inputString}`;
	return createHash('sha256').update(hashInput).digest('hex');
}