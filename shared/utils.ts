import crypto from 'crypto';
import { canonicalizeEx } from 'json-canonicalize';

/**
 * Creates a SHA-256 hash of the input string.
 *
 * @param input - The input string to hash
 * @returns SHA-256 hash of the input string
 */
export const createHash = (input: string) => {
	return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
};

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
	return createHash(hashInput);
}

/**
 * Helper function to generate output hash from result data (MIP-004)
 * Format: sha256(identifierFromPurchaser;escapedOutputString)
 * JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
 * Slicing to remove the quotes
 */
export function generateOutputHash(identifierFromPurchaser: string, outputValue: any): string {
	// JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
	// Slicing to remove the quotes
	const escaped = JSON.stringify(outputValue).slice(1, -1);
	return createHash(identifierFromPurchaser + ';' + escaped);
}