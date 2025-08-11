import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { createPayment, preparePaymentData, type MasumiConfig } from './create-payment';
import { createPurchase } from './create-purchase';
import { pollPaymentStatus } from './check-payment-status';

// Import package.json to get version automatically
const packageJson = require('../../../package.json');

// All interfaces are now imported from the individual function files
// Helper functions are now imported from create-payment.ts

export class MasumiPaywall implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Masumi Paywall',
		name: 'masumiPaywall',
		icon: 'file:masumi-logo.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["paymentMode"]}}',
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
		hints: [
			{
				message: `Masumi Node for n8n v${packageJson.version}`,
				type: 'info',
				location: 'ndv',
				whenToDisplay: 'always'
			}
		],
		properties: [
			{
				displayName: 'Payment Mode',
				name: 'paymentMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Payment Creation & Polling',
						value: 'createAndPoll',
						description:
							'Creates payment request and polls for external payment (normal use, sokosumi compatible)',
					},
					{
						name: 'Full Payment Flow (Testing)',
						value: 'fullFlowWithPurchase',
						description:
							'Creates payment + purchase request only (does NOT send funds - will timeout)',
					},
				],
				default: 'createAndPoll',
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
				displayName: 'Timeout (Minutes)',
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
				displayName: 'Poll Interval (Seconds)',
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

		const paymentMode = this.getNodeParameter('paymentMode', 0) as string;
		const inputData = this.getNodeParameter('inputData', 0) as string;
		const timeout = this.getNodeParameter('timeout', 0) as number;
		const pollInterval = this.getNodeParameter('pollInterval', 0) as number;

		// get credentials
		const credentials = await this.getCredentials('masumiPaywallApi');

		for (let i = 0; i < items.length; i++) {
			try {
				const result = await processPayment(
					{ input_string: inputData },
					credentials,
					timeout,
					pollInterval,
					paymentMode,
				);

				returnData.push({
					json: result,
				});
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

/**
 * Simplified payment processing using the three clean functions
 */
async function processPayment(
	inputData: any,
	credentials: any,
	timeout: number,
	pollInterval: number,
	paymentMode: string,
): Promise<any> {
	console.log(`\n🚀 Processing payment in mode: ${paymentMode}`);
	console.log(`📝 Input data:`, inputData);

	try {
		// 1. Prepare configuration from credentials
		const config: MasumiConfig = {
			paymentServiceUrl: credentials.paymentServiceUrl,
			apiKey: credentials.apiKey,
			agentIdentifier: credentials.agentIdentifier,
			network: credentials.network,
			sellerVkey: credentials.sellerVkey,
		};

		// 2. Prepare payment data using helper function
		const paymentData = preparePaymentData(inputData);

		console.log(`🔑 Generated values:`, {
			inputHash: paymentData.inputHash,
			identifier: paymentData.identifierFromPurchaser,
		});

		// 3. Create payment request using simplified function
		console.log(`📤 Creating payment request...`);
		const paymentResponse = await createPayment(config, paymentData);
		console.log(`📥 Payment response:`, {
			blockchainIdentifier:
				paymentResponse.data?.blockchainIdentifier?.substring(0, 50) + '...',
			payByTime: paymentResponse.data?.payByTime,
			submitResultTime: paymentResponse.data?.submitResultTime,
		});

		// 4. Handle different payment modes
		if (paymentMode === 'createAndPoll') {
			// Poll for external payment (no purchase)
			console.log(`🔄 Polling for external payment...`);
			const finalResult = await pollPaymentStatus(
				config,
				paymentResponse.data.blockchainIdentifier,
				{
					timeoutMinutes: timeout,
					intervalSeconds: pollInterval,
				},
			);

			return {
				// === BUSINESS LOGIC INDICATORS ===
				paymentConfirmed: finalResult.success, // only true if FundsLocked identified
				onChainState: finalResult.payment?.onChainState || finalResult.status || null,

				// === KEY IDENTIFIERS ===
				blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
				inputHash: paymentData.inputHash,
				PaidFunds: finalResult.payment?.PaidFunds || paymentResponse.data.RequestedFunds || [],

				// === FINAL PAYMENT STATE ===
				finalPaymentState: finalResult.payment,

				// === DEBUG/AUDIT TRAIL ===
				debug: {
					paymentCreation: paymentResponse.data,
					polling: {
						result: finalResult,
						timeoutMinutes: timeout,
						intervalSeconds: pollInterval,
					},
					originalInput: inputData,
					message: finalResult.message,
					timestamp: new Date().toISOString(),
				},
			};
		}

		if (paymentMode === 'fullFlowWithPurchase') {
			// Create purchase and poll
			console.log(`💰 Creating purchase to lock funds...`);
			const purchaseResponse = await createPurchase(
				config,
				paymentResponse,
				paymentData.identifierFromPurchaser,
			);
			console.log(`✅ Purchase created successfully`);

			// Poll for payment status using user-configured timeout
			console.log(`🔄 Polling for payment confirmation...`);
			const finalResult = await pollPaymentStatus(
				config,
				paymentResponse.data.blockchainIdentifier,
				{
					timeoutMinutes: timeout,
					intervalSeconds: pollInterval,
				},
			);

			return {
				// === BUSINESS LOGIC INDICATORS ===
				paymentConfirmed: finalResult.success, // only true if FundsLocked identified
				onChainState: finalResult.payment?.onChainState || finalResult.status || null,

				// === KEY IDENTIFIERS ===
				blockchainIdentifier: paymentResponse.data.blockchainIdentifier,
				inputHash: paymentData.inputHash,
				PaidFunds: finalResult.payment?.PaidFunds || purchaseResponse.data.PaidFunds || paymentResponse.data.RequestedFunds || [],

				// === FINAL PAYMENT STATE ===
				finalPaymentState: finalResult.payment,

				// === DEBUG/AUDIT TRAIL ===
				debug: {
					paymentCreation: paymentResponse.data,
					purchaseCreation: purchaseResponse.data,
					polling: {
						result: finalResult,
						timeoutMinutes: timeout,
						intervalSeconds: pollInterval,
					},
					originalInput: inputData,
					message: finalResult.message,
					timestamp: new Date().toISOString(),
				},
			};
		}

		// Fallback - should not reach here
		throw new NodeOperationError(
			{ type: 'MasumiPaywall', version: 1 } as any,
			`Invalid payment mode: ${paymentMode}`,
		);
	} catch (error) {
		console.error('❌ Payment processing failed:', error);
		throw new NodeOperationError(
			{ type: 'MasumiPaywall', version: 1 } as any,
			`Payment processing failed: ${(error as Error).message}`,
		);
	}
}
