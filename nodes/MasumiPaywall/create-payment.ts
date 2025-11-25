import { createHash, randomBytes } from 'crypto';
import { generateInputHash } from '../../shared/utils';

export interface MasumiConfig {
	paymentServiceUrl: string;
	apiKey: string;
	agentIdentifier: string;
	network: string;
	sellerVkey: string;
}

export interface PaymentData {
	identifierFromPurchaser: string;
	inputData: any;
	inputHash: string;
}

export interface PaymentResponse {
	status: string;
	data: {
		id: string;
		blockchainIdentifier: string;
		payByTime: string;
		submitResultTime: string;
		unlockTime: string;
		externalDisputeUnlockTime: string;
		inputHash: string;
		onChainState: string | null;
		NextAction: {
			requestedAction: string;
			resultHash: string | null;
			errorType: string | null;
			errorNote: string | null;
		};
		RequestedFunds: Array<{ amount: string; unit: string }>;
		PaymentSource: {
			network: string;
			smartContractAddress: string;
			policyId: string;
			paymentType: string;
		};
		SmartContractWallet: {
			walletVkey: string;
			walletAddress: string;
		};
		metadata: string;
	};
}

/**
 * Simple function to create a payment request via Masumi API
 * Based on the Python quickstart template and sokosumi SDK
 */
export async function createPayment(
	config: MasumiConfig,
	paymentData: PaymentData,
	submitResultTimeMinutes?: number,
): Promise<PaymentResponse> {
	const { paymentServiceUrl, apiKey, agentIdentifier, network } = config;
	const { identifierFromPurchaser, inputData, inputHash } = paymentData;

	// generate timestamps like the python implementation
	const now = new Date();
	const payByTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
	const submitResultTime = new Date(now.getTime() + (submitResultTimeMinutes || 20) * 60 * 1000);

	const requestBody = {
		agentIdentifier: agentIdentifier,
		network: network,
		inputHash: inputHash,
		payByTime: payByTime.toISOString(),
		metadata: `payment request for: ${JSON.stringify(inputData).substring(0, 100)}`,
		paymentType: 'Web3CardanoV1',
		submitResultTime: submitResultTime.toISOString(),
		identifierFromPurchaser: identifierFromPurchaser,
	};

	const response = await fetch(`${paymentServiceUrl}/payment/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			token: apiKey,
			accept: 'application/json',
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`payment creation failed: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	const result = await response.json();
	return result as PaymentResponse;
}


/**
 * Helper function to generate purchaser identifier
 */
export function generateIdentifier(): string {
	return randomBytes(7).toString('hex');
}

/**
 * Helper function to prepare payment data
 */
export function preparePaymentData(inputData: any, identifierFromPurchaser?: string): PaymentData {
	const identifier = identifierFromPurchaser || generateIdentifier();
	const inputHash = generateInputHash(identifier, inputData);

	return {
		identifierFromPurchaser: identifier,
		inputData,
		inputHash,
	};
}
