import type { MasumiConfig, PaymentResponse } from './create-payment';

export interface PurchaseResponse {
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
			errorType: string | null;
			errorNote: string | null;
		};
		PaidFunds: Array<{ amount: string; unit: string }>;
		PaymentSource: {
			network: string;
			policyId: string;
			smartContractAddress: string;
			paymentType: string;
		};
		SellerWallet: {
			walletVkey: string;
		};
		metadata: string | null;
	};
}

/**
 * Simple function to create a purchase request via Masumi API
 * Based on the Python quickstart template and sokosumi SDK
 */
export async function createPurchase(
	config: MasumiConfig,
	paymentResponse: PaymentResponse,
	identifierFromPurchaser: string,
): Promise<PurchaseResponse> {
	const { paymentServiceUrl, apiKey, agentIdentifier, network, sellerVkey } = config;
	const paymentData = paymentResponse.data;

	// use exact values from payment response - critical for blockchain signature validation
	const requestBody = {
		identifierFromPurchaser: identifierFromPurchaser,
		network: network,
		sellerVkey: sellerVkey,
		paymentType: 'Web3CardanoV1',
		blockchainIdentifier: paymentData.blockchainIdentifier,
		payByTime: String(paymentData.payByTime),
		submitResultTime: String(paymentData.submitResultTime),
		unlockTime: String(paymentData.unlockTime),
		externalDisputeUnlockTime: String(paymentData.externalDisputeUnlockTime),
		agentIdentifier: agentIdentifier,
		inputHash: paymentData.inputHash,
	};

	try {
		const response = await fetch(`${paymentServiceUrl}/purchase/`, {
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
				`purchase creation failed: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const result = await response.json();
		return result as PurchaseResponse;
	} catch (error) {
		throw new Error(`purchase creation failed: ${(error as Error).message}`);
	}
}
