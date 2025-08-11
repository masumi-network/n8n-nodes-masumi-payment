import { createPayment, preparePaymentData, type MasumiConfig } from './create-payment';
import { createPurchase } from './create-purchase';
import { checkPaymentStatus, pollPaymentStatus } from './check-payment-status';
import * as dotenv from 'dotenv';

// load environment variables for integration tests
dotenv.config();

// skip integration tests by default - run with npm run test:integration
const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const conditionalDescribe = runIntegration ? describe : describe.skip;

conditionalDescribe('integration tests with real masumi API', () => {
	let config: MasumiConfig;

	beforeAll(() => {
		// validate environment variables are present
		const requiredEnvVars = [
			'MASUMI_PAYMENT_SERVICE_URL',
			'MASUMI_API_KEY',
			'MASUMI_AGENT_IDENTIFIER',
			'MASUMI_SELLER_VKEY',
		];

		const missing = requiredEnvVars.filter(env => !process.env[env]);
		if (missing.length > 0) {
			throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
		}

		config = {
			paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL!,
			apiKey: process.env.MASUMI_API_KEY!,
			agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER!,
			network: process.env.MASUMI_NETWORK || 'Preprod',
			sellerVkey: process.env.MASUMI_SELLER_VKEY!,
		};

		console.log('🔧 integration test configuration:');
		console.log(`   service URL: ${config.paymentServiceUrl}`);
		console.log(`   network: ${config.network}`);
		console.log(`   agent: ${config.agentIdentifier}`);
	});

	describe('payment creation flow', () => {
		it('should create payment request successfully', async () => {
			const testInput = {
				test: 'integration test data',
				timestamp: new Date().toISOString(),
			};

			console.log('🧪 testing payment creation...');
			const paymentData = preparePaymentData(testInput);

			expect(paymentData.identifierFromPurchaser).toMatch(/^[a-f0-9]{14}$/);
			expect(paymentData.inputHash).toMatch(/^[a-f0-9]{64}$/);

			const paymentResponse = await createPayment(config, paymentData);

			console.log('✅ payment created:', {
				blockchainId: paymentResponse.data.blockchainIdentifier?.substring(0, 20) + '...',
				payByTime: paymentResponse.data.payByTime,
			});

			expect(paymentResponse.data.blockchainIdentifier).toBeDefined();
			expect(paymentResponse.data.payByTime).toBeDefined();
			expect(paymentResponse.data.submitResultTime).toBeDefined();
		}, 30000);
	});

	describe('payment status checking', () => {
		it('should check payment status without errors', async () => {
			// use a dummy blockchain identifier for status checking
			const dummyId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

			console.log('🧪 testing payment status check...');

			// this should not throw an error, even if payment doesn't exist
			const status = await checkPaymentStatus(config, dummyId);

			console.log('✅ status check completed:', {
				found: status !== null,
				state: status?.onChainState || 'not found',
			});

			// status can be null (payment not found) or a valid payment object
			if (status) {
				expect(typeof status.blockchainIdentifier).toBe('string');
				expect(
					status.onChainState === null || typeof status.onChainState === 'string',
				).toBe(true);
			}
		}, 15000);
	});

	describe('full payment flow (requires actual ADA)', () => {
		// this test is skipped by default to avoid blockchain costs
		it.skip('should complete full payment + purchase flow', async () => {
			const testInput = {
				integration: 'full flow test',
				timestamp: new Date().toISOString(),
			};

			console.log('🧪 testing full payment flow...');

			// step 1: create payment
			const paymentData = preparePaymentData(testInput);
			const paymentResponse = await createPayment(config, paymentData);

			console.log(
				'✅ payment created:',
				paymentResponse.data.blockchainIdentifier?.substring(0, 20) + '...',
			);

			// step 2: create purchase (locks funds on blockchain)
			const purchaseResponse = await createPurchase(
				config,
				paymentResponse,
				paymentData.identifierFromPurchaser,
			);

			console.log('✅ purchase created:', {
				id: purchaseResponse.data?.id?.substring(0, 20) + '...',
				state: purchaseResponse.data?.onChainState || 'pending',
			});

			// step 3: poll for FundsLocked state (this takes 2-5 minutes)
			console.log('⏳ polling for FundsLocked state...');
			const pollResult = await pollPaymentStatus(
				config,
				paymentResponse.data.blockchainIdentifier,
				{ timeoutMinutes: 6, intervalSeconds: 30 },
			);

			console.log('✅ polling completed:', {
				success: pollResult.success,
				status: pollResult.status,
				message: pollResult.message,
			});

			// expect either success (FundsLocked) or specific failure states
			expect(
				['FundsLocked', 'timeout', 'FundsOrDatumInvalid'].includes(pollResult.status),
			).toBe(true);
		}, 400000); // 6+ minute timeout for blockchain confirmation
	});

	describe('error handling', () => {
		it('should handle invalid API key gracefully', async () => {
			const badConfig = { ...config, apiKey: 'invalid-key' };
			const testInput = { test: 'error test' };
			const paymentData = preparePaymentData(testInput);

			console.log('🧪 testing error handling...');

			await expect(createPayment(badConfig, paymentData)).rejects.toThrow(
				/payment creation failed/,
			);

			console.log('✅ error handling works correctly');
		}, 15000);
	});
});

// export test utilities for manual testing
export async function runManualIntegrationTest() {
	console.log('🚀 Manual Integration Test');
	console.log('='.repeat(50));

	const config: MasumiConfig = {
		paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL!,
		apiKey: process.env.MASUMI_API_KEY!,
		agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER!,
		network: process.env.MASUMI_NETWORK || 'Preprod',
		sellerVkey: process.env.MASUMI_SELLER_VKEY!,
	};

	try {
		// test payment creation
		console.log('🧪 1. Testing payment creation...');
		const testInput = { manual: 'test', timestamp: new Date().toISOString() };
		const paymentData = preparePaymentData(testInput);
		const paymentResponse = await createPayment(config, paymentData);
		console.log('✅ Payment created successfully');

		// test status check
		console.log('🧪 2. Testing status check...');
		const status = await checkPaymentStatus(config, paymentResponse.data.blockchainIdentifier);
		console.log(`✅ Status check: ${status ? 'found' : 'not found'}`);

		console.log('\n' + '='.repeat(50));
		console.log('✅ Manual integration test completed!');
	} catch (error) {
		console.error('\n' + '='.repeat(50));
		console.error('❌ Manual integration test failed:', error);
		throw error;
	}
}

// run manual test if executed directly
if (require.main === module) {
	runManualIntegrationTest().catch(console.error);
}
