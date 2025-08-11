import type { MasumiConfig } from './create-payment';

export interface PaymentStatus {
	blockchainIdentifier: string;
	onChainState: string | null;
	inputHash: string;
	NextAction?: {
		requestedAction: string;
		errorType: string | null;
		errorNote: string | null;
	};
	PaidFunds?: Array<{ amount: string; unit: string }>;
	CurrentTransaction?: {
		id: string;
		txHash: string;
		createdAt: string;
		updatedAt: string;
	};
}

export interface PaymentStatusResult {
	success: boolean;
	status: string;
	payment: PaymentStatus | null;
	message: string;
}

/**
 * Check payment status by identifier
 * Uses the GET /payment/ endpoint to find payment by blockchainIdentifier
 */
export async function checkPaymentStatus(
	config: MasumiConfig,
	paymentIdentifier: string,
): Promise<PaymentStatus | null> {
	const { paymentServiceUrl, apiKey, network } = config;

	// use query parameter to find payment by blockchainIdentifier
	const url = `${paymentServiceUrl}/payment/?blockchainIdentifier=${paymentIdentifier}&network=${network}`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				accept: 'application/json',
				token: apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`status check failed: ${response.status} ${response.statusText}`);
		}

		const result: any = await response.json();

		// find payment in response
		let payment = null;

		// check if response has data.payments array
		if (result.data && result.data.payments && Array.isArray(result.data.payments)) {
			payment =
				result.data.payments.find(
					(p: any) => p.blockchainIdentifier === paymentIdentifier,
				) || null;
		}
		// check if response has data.Payments array (uppercase)
		else if (result.data && result.data.Payments && Array.isArray(result.data.Payments)) {
			payment =
				result.data.Payments.find(
					(p: any) => p.blockchainIdentifier === paymentIdentifier,
				) || null;
		}
		// check if response is direct payment object
		else if (result.blockchainIdentifier === paymentIdentifier) {
			payment = result;
		}

		return payment as PaymentStatus | null;
	} catch (error) {
		console.error('error checking payment status:', error);
		throw error;
	}
}

/**
 * Simple function to poll payment status from Masumi API
 * Based on the Python quickstart template and sokosumi SDK
 */
export async function pollPaymentStatus(
	config: MasumiConfig,
	paymentIdentifier: string,
	options: { timeoutMinutes?: number; intervalSeconds?: number } = {},
): Promise<PaymentStatusResult> {
	const { timeoutMinutes = 10, intervalSeconds = 10 } = options;

	const timeoutMs = timeoutMinutes * 60 * 1000;
	const intervalMs = intervalSeconds * 1000;
	const startTime = Date.now();

	console.log('starting payment status polling:', {
		paymentIdentifier: paymentIdentifier.substring(0, 50) + '...',
		timeoutMinutes,
		intervalSeconds,
		network: config.network,
	});

	let pollCount = 0;

	while (Date.now() - startTime < timeoutMs) {
		pollCount++;
		const elapsed = Math.round((Date.now() - startTime) / 1000);
		console.log(`\npoll attempt #${pollCount} (${elapsed}s elapsed)`);

		try {
			const status = await checkPaymentStatus(config, paymentIdentifier);

			if (status) {
				const onChainState = status.onChainState;
				console.log(`payment status: ${onChainState || 'pending'}`);

				// success states - funds are locked, can proceed
				if (onChainState === 'FundsLocked') {
					console.log('✅ payment confirmed! funds are locked');
					return {
						success: true,
						status: onChainState,
						payment: status,
						message: 'payment confirmed',
					};
				}

				// success states - payment already processed
				if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
					console.log('✅ payment already processed');
					return {
						success: true,
						status: onChainState,
						payment: status,
						message: 'payment already processed',
					};
				}

				// error states - payment failed
				if (
					onChainState &&
					[
						'FundsOrDatumInvalid',
						'RefundRequested',
						'Disputed',
						'RefundWithdrawn',
						'DisputedWithdrawn',
					].includes(onChainState)
				) {
					console.log(`❌ payment failed: ${onChainState}`);
					return {
						success: false,
						status: onChainState,
						payment: status,
						message: `payment failed: ${onChainState}`,
					};
				}

				// continue polling for other states
				console.log(`⏳ still waiting... (state: ${onChainState || 'none'})`);
			} else {
				console.log('⏳ payment not found yet...');
			}

			// wait before next poll
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		} catch (error) {
			console.error(`poll error: ${(error as Error).message}`);
			// continue polling on errors
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	// timeout reached
	console.log(`⏰ polling timeout reached after ${timeoutMinutes} minutes`);
	return {
		success: false,
		status: 'timeout',
		payment: null,
		message: `payment polling timeout after ${timeoutMinutes} minutes`,
	};
}

/**
 * Helper function to interpret payment status
 */
export function interpretPaymentStatus(status: PaymentStatus | null): {
	isConfirmed: boolean;
	isError: boolean;
	shouldContinuePolling: boolean;
	message: string;
} {
	if (!status) {
		return {
			isConfirmed: false,
			isError: false,
			shouldContinuePolling: true,
			message: 'payment not found',
		};
	}

	const onChainState = status.onChainState;

	// success states
	if (onChainState === 'FundsLocked') {
		return {
			isConfirmed: true,
			isError: false,
			shouldContinuePolling: false,
			message: 'funds locked - payment confirmed',
		};
	}

	if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
		return {
			isConfirmed: true,
			isError: false,
			shouldContinuePolling: false,
			message: 'payment already processed',
		};
	}

	// error states
	if (
		onChainState &&
		[
			'FundsOrDatumInvalid',
			'RefundRequested',
			'Disputed',
			'RefundWithdrawn',
			'DisputedWithdrawn',
		].includes(onChainState)
	) {
		return {
			isConfirmed: false,
			isError: true,
			shouldContinuePolling: false,
			message: `payment failed: ${onChainState}`,
		};
	}

	// continue polling states
	return {
		isConfirmed: false,
		isError: false,
		shouldContinuePolling: true,
		message: `still processing: ${onChainState || 'pending'}`,
	};
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

	console.log('🔍 Masumi Payment Status Checker');
	console.log('='.repeat(50));

	// get blockchain identifier
	const paymentIdentifier = parsed['blockchain-identifier'] || args[0];
	if (!paymentIdentifier) {
		console.error('❌ Error: Missing required parameter: blockchain-identifier');
		console.error('💡 Usage:');
		console.error('  ts-node check-payment-status.ts --blockchain-identifier <id> [options]');
		console.error('  ts-node check-payment-status.ts <blockchain-identifier> [options]');
		console.error('  Options:');
		console.error('    --payment-service-url <url>');
		console.error('    --api-key <key>');
		console.error('    --network <network>');
		console.error(
			'\n  Or set environment variables: MASUMI_PAYMENT_SERVICE_URL, MASUMI_API_KEY, etc.',
		);
		process.exit(1);
	}

	// get config from env or args
	const config: MasumiConfig = {
		paymentServiceUrl: parsed['payment-service-url'] || process.env.MASUMI_PAYMENT_SERVICE_URL!,
		apiKey: parsed['api-key'] || process.env.MASUMI_API_KEY!,
		agentIdentifier: parsed['agent-identifier'] || process.env.MASUMI_AGENT_IDENTIFIER!,
		network: parsed['network'] || process.env.MASUMI_NETWORK || 'Preprod',
		sellerVkey: parsed['seller-vkey'] || process.env.MASUMI_SELLER_VKEY!,
	};

	// validate required config
	const required = ['paymentServiceUrl', 'apiKey'];
	for (const key of required) {
		if (!config[key as keyof MasumiConfig]) {
			console.error(`❌ Error: Missing required parameter: ${key}`);
			process.exit(1);
		}
	}

	console.log(`🆔 Payment ID: ${paymentIdentifier.substring(0, 50)}...`);
	console.log(`🌐 Network: ${config.network}`);
	console.log('');

	try {
		const status = await checkPaymentStatus(config, paymentIdentifier);

		if (status) {
			console.log('✅ Payment found!');
			console.log('📋 Payment Details:');
			console.log(`   On-chain state: ${status.onChainState || 'null/pending'}`);
			console.log(`   Blockchain ID: ${status.blockchainIdentifier?.substring(0, 50)}...`);

			if (status.NextAction) {
				console.log(`   Next action: ${status.NextAction.requestedAction}`);
				if (status.NextAction.errorType) {
					console.log(`   Error type: ${status.NextAction.errorType}`);
					console.log(`   Error note: ${status.NextAction.errorNote}`);
				}
			}

			if (status.CurrentTransaction) {
				console.log(`   Transaction hash: ${status.CurrentTransaction.txHash}`);
			}

			// interpret the status
			const interpretation = interpretPaymentStatus(status);
			console.log('');
			console.log(`💡 ${interpretation.message}`);
		} else {
			console.log('❌ Payment not found');
			console.log('💡 The payment might not exist or the blockchain identifier is incorrect');
		}

		console.log('\n' + '='.repeat(50));
		console.log('✅ Payment status check completed!');
	} catch (error) {
		console.error('\n' + '='.repeat(50));
		console.error('❌ Payment status check failed:', error);
		process.exit(1);
	}
}

// run standalone test if executed directly
if (require.main === module) {
	main();
}
