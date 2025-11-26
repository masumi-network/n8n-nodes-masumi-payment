import crypto from 'crypto';

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
 * Canonicalize object similar to json-canonicalize
 * Sorts keys and filters undefined values
 */
function canonicalize(obj: any): string {
	if (obj === null || typeof obj !== 'object' || obj.toJSON) {
		return JSON.stringify(obj);
	}
	if (Array.isArray(obj)) {
		return (
			'[' +
			obj.reduce((t: string, cv: any, ci: number) => {
				const comma = ci === 0 ? '' : ',';
				const value = cv === undefined || typeof cv === 'symbol' ? 'null' : canonicalize(cv);
				return t + comma + value;
			}, '') +
			']'
		);
	}
	const keys = Object.keys(obj).sort();
	return (
		'{' +
		keys.reduce((t: string, cv: string, ci: number) => {
			const comma = ci === 0 ? '' : ',';
			const value =
				obj[cv] === undefined || typeof obj[cv] === 'symbol' ? '' : canonicalize(obj[cv]);
			if (value === '') return t; // Skip undefined
			return t + (t && value ? ',' : '') + JSON.stringify(cv) + ':' + value;
		}, '') +
		'}'
	);
}

/**
 * Helper function to generate input hash from data
 * Format: sha256(identifierFromPurchaser;canonicalizedInputString)
 */
export function generateInputHash(identifierFromPurchaser: string, inputData: any): string {
	const object =
		typeof inputData === 'object' && inputData !== null
			? inputData
			: Object.fromEntries(inputData);
	
	// Simple canonicalization with sorted keys
	const inputString = canonicalize(object);
	const hashInput = `${identifierFromPurchaser};${inputString}`;
	return createHash(hashInput);
}

/**
 * Helper function to generate output hash from result data (MIP-004)
 * Format: sha256(identifierFromPurchaser;escapedOutputString)
 * JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
 * Slicing to remove the quotes
 */


export const getResultHash = (
	identifierFromPurchaser: string,
	result: string,
  ) => {
	// JSON.stringify escapes \n, \r, \t, backslashes, quotes, etc.
	// Slicing to remove the quotes
	const data = `${identifierFromPurchaser};${result}`;
	try {
	  const escaped = JSON.stringify(data).slice(1, -1);
	  return createHash(escaped);
	} catch {
	  return null;
	}
  };