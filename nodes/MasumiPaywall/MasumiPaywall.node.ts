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

function evaluatePaymentStatus(
	paymentStatusResponse: PaymentStatusResponse,
	blockchainIdentifier: string,
): { isPaymentConfirmed: boolean; paymentStatus: string; ourPayment?: any } {
	// find our payment in the response
	let ourPayment = null;
	if (paymentStatusResponse.data && paymentStatusResponse.data.Payments) {
		ourPayment = paymentStatusResponse.data.Payments.find(
			payment => payment.blockchainIdentifier === blockchainIdentifier
		);
	}

	let isPaymentConfirmed = false;
	let paymentStatus = 'not_found';

	if (ourPayment) {
		const onChainState = ourPayment.onChainState;
		paymentStatus = onChainState || 'pending';
		isPaymentConfirmed = onChainState === 'FundsLocked';
	}

	return {
		isPaymentConfirmed,
		paymentStatus,
		ourPayment,
	};
}

async function pollPaymentStatus(
	this: IExecuteFunctions,
	credentials: any,
	blockchainIdentifier: string,
	timeout: number,
	pollInterval: number,
): Promise<{ isPaymentConfirmed: boolean; paymentStatus: string }> {
	const startTime = Date.now();
	const timeoutMs = timeout * 60 * 1000;
	const intervalMs = pollInterval * 1000;

	// initial wait before first check
	await new Promise(resolve => setTimeout(resolve, 2000));

	while (Date.now() - startTime < timeoutMs) {
		try {
			const paymentStatusResponse = await checkPaymentStatus.call(this, credentials);
			const evaluation = evaluatePaymentStatus(paymentStatusResponse, blockchainIdentifier);

			if (evaluation.isPaymentConfirmed) {
				return {
					isPaymentConfirmed: true,
					paymentStatus: evaluation.paymentStatus,
				};
			}

			// if payment is found but not confirmed, keep polling
			if (evaluation.paymentStatus !== 'not_found') {
				// payment exists but not yet locked, continue polling
			}

			await new Promise(resolve => setTimeout(resolve, intervalMs));
		} catch (error) {
			// log error but continue polling
			console.error('Error polling payment status:', (error as Error).message);
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	// timeout exceeded, return current status
	try {
		const paymentStatusResponse = await checkPaymentStatus.call(this, credentials);
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
		const inputData = this.getNodeParameter('inputData', 0) as string;
		const timeout = this.getNodeParameter('timeout', 0) as number;
		const pollInterval = this.getNodeParameter('pollInterval', 0) as number;

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

		// 3. prepare and create purchase request
		const purchaseRequest = preparePurchaseRequest(
			paymentResponse,
			inputData,
			identifier,
			credentials,
		);
		await createPurchase.call(this, purchaseRequest, credentials);

		// 4. poll for payment status
		const finalResult = await pollPaymentStatus.call(
			this,
			credentials,
			paymentResponse.data.blockchainIdentifier,
			timeout,
			pollInterval,
		);

		return {
			success: true,
			isPaymentConfirmed: finalResult.isPaymentConfirmed,
			paymentStatus: finalResult.paymentStatus,
			blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
			identifier,
			inputHash,
			originalInput: inputData,
			timestamp: new Date().toISOString(),
		};
	} catch (error) {
		throw new NodeOperationError(this.getNode(), `Payment processing failed: ${(error as Error).message}`);
	}
}