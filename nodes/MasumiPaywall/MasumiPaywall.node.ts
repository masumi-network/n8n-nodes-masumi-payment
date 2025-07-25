import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { createHash, randomBytes } from 'crypto';

interface PaymentRequest {
	agentIdentifier: string;
	network: string;
	inputHash: string;
	payByTime: string;
	metadata: string;
	paymentType: string;
	submitResultTime: string;
	identifierFromPurchaser: string;
}

interface PaymentResponse {
	data: {
		blockchainIdentifier: string;
		inputHash: string;
		payByTime: number;
		submitResultTime: number;
		unlockTime: number;
		externalDisputeUnlockTime: number;
	};
}

interface PurchaseRequest {
	identifierFromPurchaser: string;
	network: string;
	sellerVkey: string;
	paymentType: string;
	blockchainIdentifier: string;
	payByTime: string;
	submitResultTime: string;
	unlockTime: string;
	externalDisputeUnlockTime: string;
	agentIdentifier: string;
	inputHash: string;
}

interface PaymentStatusResponse {
	data: {
		Payments?: Array<{
			blockchainIdentifier: string;
			onChainState?: string;
		}>;
	};
}

// helper functions
function generateInputHash(inputData: any): string {
	// extract input_string from inputData, default to "hello world" like Python version
	const inputString = inputData.input_string || 'hello world';
	return createHash('sha256').update(inputString, 'utf8').digest('hex');
}

function generateIdentifier(): string {
	// generate 14-character hex identifier (7 bytes = 14 hex chars)
	return randomBytes(7).toString('hex');
}

function preparePaymentRequest(
	inputData: any,
	inputHash: string,
	identifier: string,
	credentials: any,
): PaymentRequest {
	// generate timestamps (ISO format for /payment endpoint)
	const now = new Date();
	
	// payByTime: 5 minutes from now
	const payByTime = new Date(now.getTime() + 5 * 60 * 1000);
	const payByTimeIso = payByTime.toISOString();
	
	// submitResultTime: 20 minutes from now (15+ minute gap)
	const submitResultTime = new Date(now.getTime() + 20 * 60 * 1000);
	const submitResultTimeIso = submitResultTime.toISOString();

	return {
		agentIdentifier: credentials.agentIdentifier,
		network: credentials.network,
		inputHash: inputHash,
		payByTime: payByTimeIso,
		metadata: `Paywall request for input: ${JSON.stringify(inputData).substring(0, 100)}`,
		paymentType: 'Web3CardanoV1',
		submitResultTime: submitResultTimeIso,
		identifierFromPurchaser: identifier,
	};
}

async function createPaymentRequest(
	this: IExecuteFunctions,
	paymentRequest: PaymentRequest,
	credentials: any,
): Promise<PaymentResponse> {
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: `${credentials.paymentServiceUrl}/payment/`,
		headers: {
			'Content-Type': 'application/json',
			'token': credentials.apiKey,
			'accept': 'application/json',
		},
		body: paymentRequest,
		json: true,
	};

	const response = await this.helpers.httpRequest(options);
	return response as PaymentResponse;
}

function preparePurchaseRequest(
	paymentResponse: PaymentResponse,
	inputData: any,
	identifier: string,
	credentials: any,
): PurchaseRequest {
	const paymentData = paymentResponse.data;
	
	// use exact timestamps from payment response (already in milliseconds)
	// critical: we cannot change timing values because the blockchain identifier
	// signature is cryptographically tied to the original timestamps
	const payByTimeMillis = String(paymentData.payByTime);
	const submitResultTimeMillis = String(paymentData.submitResultTime);
	const unlockTimeMillis = String(paymentData.unlockTime);
	const externalDisputeUnlockTimeMillis = String(paymentData.externalDisputeUnlockTime);

	return {
		identifierFromPurchaser: identifier,
		network: credentials.network,
		sellerVkey: credentials.sellerVkey,
		paymentType: 'Web3CardanoV1',
		blockchainIdentifier: paymentData.blockchainIdentifier,
		payByTime: payByTimeMillis,
		submitResultTime: submitResultTimeMillis,
		unlockTime: unlockTimeMillis,
		externalDisputeUnlockTime: externalDisputeUnlockTimeMillis,
		agentIdentifier: credentials.agentIdentifier,
		inputHash: paymentData.inputHash,
	};
}

async function createPurchase(
	this: IExecuteFunctions,
	purchaseRequest: PurchaseRequest,
	credentials: any,
): Promise<any> {
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: `${credentials.paymentServiceUrl}/purchase/`,
		headers: {
			'Content-Type': 'application/json',
			'token': credentials.apiKey,
			'accept': 'application/json',
		},
		body: purchaseRequest,
		json: true,
	};

	const response = await this.helpers.httpRequest(options);
	return response;
}

async function checkPaymentStatus(
	this: IExecuteFunctions,
	credentials: any,
): Promise<PaymentStatusResponse> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: `${credentials.paymentServiceUrl}/payment/`,
		headers: {
			'accept': 'application/json',
			'token': credentials.apiKey,
		},
		qs: {
			limit: '10',
			network: credentials.network,
			includeHistory: 'false',
		},
		json: true,
	};

	const response = await this.helpers.httpRequest(options);
	return response as PaymentStatusResponse;
}

async function checkPurchaseStatus(
	this: IExecuteFunctions,
	credentials: any,
): Promise<PaymentStatusResponse> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: `${credentials.paymentServiceUrl}/purchase/`,
		headers: {
			'accept': 'application/json',
			'token': credentials.apiKey,
		},
		qs: {
			limit: '10',
			network: credentials.network,
			includeHistory: 'false',
		},
		json: true,
	};

	const response = await this.helpers.httpRequest(options);
	return response as PaymentStatusResponse;
}

function evaluatePaymentStatus(
	paymentStatusResponse: PaymentStatusResponse,
	blockchainIdentifier: string,
): { isPaymentConfirmed: boolean; paymentStatus: string; shouldContinuePolling: boolean; isError: boolean; ourPayment?: any } {
	// find our payment in the response - check both Payments and Purchases
	let ourPayment = null;
	if (paymentStatusResponse.data) {
		if (paymentStatusResponse.data.Payments) {
			ourPayment = paymentStatusResponse.data.Payments.find(
				payment => payment.blockchainIdentifier === blockchainIdentifier
			);
		} else if ((paymentStatusResponse.data as any).Purchases) {
			ourPayment = (paymentStatusResponse.data as any).Purchases.find(
				purchase => purchase.blockchainIdentifier === blockchainIdentifier
			);
		}
	}

	let isPaymentConfirmed = false;
	let paymentStatus = 'not_found';
	let shouldContinuePolling = true;
	let isError = false;

	if (ourPayment) {
		const onChainState = ourPayment.onChainState;
		paymentStatus = onChainState || 'pending';

		// SUCCESS states - stop polling
		if (onChainState === 'FundsLocked') {
			isPaymentConfirmed = true;
			shouldContinuePolling = false;
		} else if (onChainState === 'ResultSubmitted' || onChainState === 'Withdrawn') {
			isPaymentConfirmed = true;
			shouldContinuePolling = false;
		}
		// ERROR states - stop polling with error
		else if (onChainState && ['FundsOrDatumInvalid', 'RefundRequested', 'Disputed', 'RefundWithdrawn', 'DisputedWithdrawn'].includes(onChainState)) {
			isPaymentConfirmed = false;
			shouldContinuePolling = false;
			isError = true;
		}
		// CONTINUE POLLING states - any other state or no state
		else {
			shouldContinuePolling = true;
		}
	}

	return {
		isPaymentConfirmed,
		paymentStatus,
		shouldContinuePolling,
		isError,
		ourPayment,
	};
}

async function pollPaymentStatus(
	this: IExecuteFunctions,
	credentials: any,
	blockchainIdentifier: string,
	timeout: number,
	pollInterval: number,
	hasPurchase: boolean = false,
): Promise<{ isPaymentConfirmed: boolean; paymentStatus: string }> {
	const startTime = Date.now();
	const timeoutMs = timeout * 60 * 1000;
	const intervalMs = pollInterval * 1000;

	// initial wait before first check
	await new Promise(resolve => setTimeout(resolve, 2000));

	while (Date.now() - startTime < timeoutMs) {
		try {
			// if we made a purchase, check purchase status; otherwise check payment status
			const paymentStatusResponse = hasPurchase ? 
				await checkPurchaseStatus.call(this, credentials) : 
				await checkPaymentStatus.call(this, credentials);
			const evaluation = evaluatePaymentStatus(paymentStatusResponse, blockchainIdentifier);

			// handle error states
			if (evaluation.isError) {
				throw new NodeOperationError(this.getNode(), `Payment failed with status: ${evaluation.paymentStatus}`);
			}

			// handle success states
			if (evaluation.isPaymentConfirmed) {
				return {
					isPaymentConfirmed: true,
					paymentStatus: evaluation.paymentStatus,
				};
			}

			// continue polling if shouldContinuePolling is true
			if (!evaluation.shouldContinuePolling) {
				// this shouldn't happen given our logic above, but just in case
				throw new NodeOperationError(this.getNode(), `Unexpected payment status: ${evaluation.paymentStatus}`);
			}

			await new Promise(resolve => setTimeout(resolve, intervalMs));
		} catch (error) {
			// re-throw NodeOperationError (our business logic errors)
			if (error instanceof NodeOperationError) {
				throw error;
			}
			// log other errors but continue polling
			console.error('Error polling payment status:', (error as Error).message);
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	// timeout exceeded, return current status
	try {
		const paymentStatusResponse = hasPurchase ? 
			await checkPurchaseStatus.call(this, credentials) : 
			await checkPaymentStatus.call(this, credentials);
		const evaluation = evaluatePaymentStatus(paymentStatusResponse, blockchainIdentifier);
		return {
			isPaymentConfirmed: evaluation.isPaymentConfirmed,
			paymentStatus: `timeout_${evaluation.paymentStatus}`,
		};
	} catch (error) {
		throw new NodeOperationError(this.getNode(), `Payment timeout exceeded and status check failed: ${(error as Error).message}`);
	}
}

export class MasumiPaywall implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Masumi Paywall',
		name: 'masumiPaywall',
		icon: 'file:masumi-logo.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Cardano blockchain paywall for monetizing n8n workflows',
		defaults: {
			name: 'Masumi Paywall',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'masumiPaywallApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Process Payment',
						value: 'processPayment',
						description: 'Execute the paywall payment flow',
						action: 'Process a payment',
					},
				],
				default: 'processPayment',
			},
			{
				displayName: 'Operation Mode',
				name: 'operationMode',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						operation: ['processPayment'],
					},
				},
				options: [
					{
						name: 'Full Payment Flow',
						value: 'fullFlow',
						description: 'Complete payment flow (create invoice → poll → process)',
					},
					{
						name: 'Create Payment Only',
						value: 'createPaymentOnly', 
						description: 'Create payment invoice only (for responding to sokosumi /start_job requests)',
					}
				],
				default: 'fullFlow',
			},
			{
				displayName: 'Skip Blockchain Purchase',
				name: 'skipPurchase',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['processPayment'],
					},
				},
				description: 'For testing: create payment request but skip actual blockchain purchase',
			},
			{
				displayName: 'Input Data',
				name: 'inputData',
				type: 'string',
				default: '',
				required: true,
				description: 'Input data to process for payment (will be hashed)',
				placeholder: 'Enter data to be processed...',
			},
			{
				displayName: 'Timeout (minutes)',
				name: 'timeout',
				type: 'number',
				default: 10,
				required: true,
				typeOptions: {
					minValue: 1,
					maxValue: 60,
				},
				description: 'Maximum time to wait for payment confirmation',
			},
			{
				displayName: 'Poll Interval (seconds)',
				name: 'pollInterval',
				type: 'number',
				default: 10,
				required: true,
				typeOptions: {
					minValue: 5,
					maxValue: 120,
				},
				description: 'Time between payment status checks',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operation = this.getNodeParameter('operation', 0);
		const operationMode = this.getNodeParameter('operationMode', 0) as string;
		const inputData = this.getNodeParameter('inputData', 0) as string;
		const timeout = this.getNodeParameter('timeout', 0) as number;
		const pollInterval = this.getNodeParameter('pollInterval', 0) as number;
		const skipPurchase = this.getNodeParameter('skipPurchase', 0) as boolean;

		// get credentials
		const credentials = await this.getCredentials('masumiPaywallApi');

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'processPayment') {
					const result = await processPayment.call(
						this,
						{ input_string: inputData },
						credentials,
						timeout,
						pollInterval,
						operationMode,
						skipPurchase,
					);

					returnData.push({
						json: result,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
							success: false,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

async function processPayment(
	this: IExecuteFunctions,
	inputData: any,
	credentials: any,
	timeout: number,
	pollInterval: number,
	operationMode: string,
	skipPurchase: boolean,
): Promise<any> {
	try {
		// 1. generate input hash and identifier
		const inputHash = generateInputHash(inputData);
		const identifier = generateIdentifier();

		// 2. prepare and create payment request
		const paymentRequest = preparePaymentRequest(
			inputData,
			inputHash,
			identifier,
			credentials,
		);
		const paymentResponse = await createPaymentRequest.call(this, paymentRequest, credentials);

		// if createPaymentOnly mode, return payment data immediately
		if (operationMode === 'createPaymentOnly') {
			return {
				success: true,
				operationMode: 'createPaymentOnly',
				inputHash,
				identifier,
				paymentData: {
					blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
					payByTime: paymentResponse.data.payByTime,
					submitResultTime: paymentResponse.data.submitResultTime,
					unlockTime: paymentResponse.data.unlockTime,
					externalDisputeUnlockTime: paymentResponse.data.externalDisputeUnlockTime,
					agentIdentifier: credentials.agentIdentifier,
					sellerVkey: credentials.sellerVkey,
					network: credentials.network,
					amounts: [{ unit: 'lovelace', amount: 1000000 }] // example amount
				},
				timestamp: new Date().toISOString(),
			};
		}

		// for fullFlow mode, continue with purchase and polling
		let purchaseData = null;
		
		if (!skipPurchase) {
			// 3. prepare and create purchase request
			const purchaseRequest = preparePurchaseRequest(
				paymentResponse,
				inputData,
				identifier,
				credentials,
			);
			purchaseData = await createPurchase.call(this, purchaseRequest, credentials);
		}

		// 4. poll for payment status
		const finalResult = await pollPaymentStatus.call(
			this,
			credentials,
			paymentResponse.data.blockchainIdentifier,
			timeout,
			pollInterval,
			!skipPurchase,  // if we didn't skip purchase, we made a purchase, so check purchase status
		);

		return {
			success: true,
			operationMode: 'fullFlow',
			isPaymentConfirmed: finalResult.isPaymentConfirmed,
			paymentStatus: finalResult.paymentStatus,
			blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
			identifier,
			inputHash,
			originalInput: inputData,
			paymentData: paymentResponse.data,
			purchaseData,
			skipPurchase,
			timestamp: new Date().toISOString(),
		};
	} catch (error) {
		throw new NodeOperationError(this.getNode(), `Payment processing failed: ${(error as Error).message}`);
	}
}