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

	// query all payments for network (API doesn't support blockchainIdentifier filter)
	const url = `${paymentServiceUrl}/payment/?network=${network}`;

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
			result.data.payments.find((p: any) => p.blockchainIdentifier === paymentIdentifier) ||
			null;
	}
	// check if response has data.Payments array (uppercase)
	else if (result.data && result.data.Payments && Array.isArray(result.data.Payments)) {
		payment =
			result.data.Payments.find((p: any) => p.blockchainIdentifier === paymentIdentifier) ||
			null;
	}
	// check if response is direct payment object
	else if (result.blockchainIdentifier === paymentIdentifier) {
		payment = result;
	}

	return payment as PaymentStatus | null;
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

	let lastPaymentStatus = null; // Track last observed payment state

	while (Date.now() - startTime < timeoutMs) {
		try {
			const status = await checkPaymentStatus(config, paymentIdentifier);

			// Keep track of last seen status for timeout reporting
			if (status) {
				lastPaymentStatus = status;
			}

			if (status) {
				const onChainState = status.onChainState;

				// success states - funds are locked, can proceed
				if (onChainState === 'FundsLocked') {
					return {
						success: true,
						status: onChainState,
						payment: status,
						message: 'payment confirmed',
					};
				}

				// success states - payment already processed
				if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
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
					return {
						success: false,
						status: onChainState,
						payment: status,
						message: `payment failed: ${onChainState}`,
					};
				}

				// continue polling for other states
			}

			// wait before next poll
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		} catch (error) {
			// continue polling on errors
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	// timeout reached
	return {
		success: false,
		status: 'timeout',
		payment: lastPaymentStatus, // Return last state instead of null
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
