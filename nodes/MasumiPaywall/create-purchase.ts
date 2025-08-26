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

// standalone execution for testing - similar to cardano-toolbox pattern
async function main() {
	// import dotenv dynamically for standalone usage
	const dotenv = await import('dotenv');
	dotenv.config();

	const args = process.argv.slice(2);
	const parsed: any = {};

	// parse command line arguments
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith('--') && i + 1 < args.length) {
			const key = arg.substring(2);
			const value = args[i + 1];
			parsed[key] = value;
			i++; // skip next argument
		}
	}

	console.log('💰 Masumi Purchase Creator');
	console.log('='.repeat(50));

	// get config from env or args
	const config: MasumiConfig = {
		paymentServiceUrl: parsed['payment-service-url'] || process.env.MASUMI_PAYMENT_SERVICE_URL!,
		apiKey: parsed['api-key'] || process.env.MASUMI_API_KEY!,
		agentIdentifier: parsed['agent-identifier'] || process.env.MASUMI_AGENT_IDENTIFIER!,
		network: parsed['network'] || process.env.MASUMI_NETWORK || 'Preprod',
		sellerVkey: parsed['seller-vkey'] || process.env.MASUMI_SELLER_VKEY!,
	};

	// validate required config
	const required = ['paymentServiceUrl', 'apiKey', 'agentIdentifier', 'sellerVkey'];
	for (const key of required) {
		if (!config[key as keyof MasumiConfig]) {
			console.error(`❌ Error: Missing required parameter: ${key}`);
			console.error('💡 Usage:');
			console.error('  ts-node create-purchase.ts [options]');
			console.error('  Options:');
			console.error('    --payment-service-url <url>');
			console.error('    --api-key <key>');
			console.error('    --agent-identifier <id>');
			console.error('    --seller-vkey <vkey>');
			console.error('    --network <network>');
			console.error('    --blockchain-identifier <id>');
			console.error('    --pay-by-time <timestamp>');
			console.error('    --submit-result-time <timestamp>');
			console.error('    --unlock-time <timestamp>');
			console.error('    --external-dispute-unlock-time <timestamp>');
			console.error('    --input-hash <hash>');
			console.error('    --identifier <purchaser-id>');
			console.error(
				'\\n  Or set environment variables: MASUMI_PAYMENT_SERVICE_URL, MASUMI_API_KEY, etc.',
			);
			process.exit(1);
		}
	}

	// create mock payment response with required data
	const paymentResponse: PaymentResponse = {
		status: 'success',
		data: {
			id: 'test',
			blockchainIdentifier:
				parsed['blockchain-identifier'] || 'missing_blockchain_identifier',
			payByTime: parsed['pay-by-time'] || '1753492250051',
			submitResultTime: parsed['submit-result-time'] || '1753493150051',
			unlockTime: parsed['unlock-time'] || '1753514750051',
			externalDisputeUnlockTime: parsed['external-dispute-unlock-time'] || '1753536350051',
			inputHash: parsed['input-hash'] || 'missing_input_hash',
			onChainState: null,
			NextAction: {
				requestedAction: 'WaitingForExternalAction',
				resultHash: null,
				errorType: null,
				errorNote: null,
			},
			RequestedFunds: [{ amount: '2000000', unit: '' }],
			PaymentSource: {
				network: config.network,
				smartContractAddress: 'test_address',
				policyId: 'test_policy',
				paymentType: 'Web3CardanoV1',
			},
			SmartContractWallet: {
				walletVkey: 'test_vkey',
				walletAddress: 'test_address',
			},
			metadata: 'test purchase',
		},
	};

	const identifierFromPurchaser = parsed['identifier'] || 'missing_identifier';

	// validate required parameters
	if (!parsed['blockchain-identifier']) {
		console.error('❌ Error: Missing required parameter: blockchain-identifier');
		console.error(
			'💡 Usage: ts-node create-purchase.ts --blockchain-identifier <id> --pay-by-time <time> --submit-result-time <time> --unlock-time <time> --external-dispute-unlock-time <time> --input-hash <hash> --identifier <id>',
		);
		process.exit(1);
	}

	console.log(
		`🆔 Blockchain ID: ${paymentResponse.data.blockchainIdentifier?.substring(0, 50)}...`,
	);
	console.log(`👤 Purchaser ID: ${identifierFromPurchaser}`);
	console.log(`🌐 Network: ${config.network}`);
	console.log('');

	try {
		const result = await createPurchase(config, paymentResponse, identifierFromPurchaser);
		console.log('📋 Purchase Details:');
		console.log(`   Blockchain ID: ${result.data?.blockchainIdentifier?.substring(0, 50)}...`);
		console.log(`   On-chain state: ${result.data?.onChainState || 'null/pending'}`);
		console.log('\\n' + '='.repeat(50));
		console.log('✅ Purchase creation completed!');
	} catch (error) {
		console.error('\\n' + '='.repeat(50));
		console.error('❌ Purchase creation failed:', error);
		process.exit(1);
	}
}

// run standalone test if executed directly
if (require.main === module) {
	main();
}
