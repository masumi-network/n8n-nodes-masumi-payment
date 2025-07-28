// Simple manual integration test for Masumi API functions
const { createPayment, preparePaymentData } = require('./dist/nodes/MasumiPaywall/create-payment');
const { checkPaymentStatus } = require('./dist/nodes/MasumiPaywall/check-payment-status');
const dotenv = require('dotenv');

// load environment variables
dotenv.config();

async function runManualIntegrationTest() {
	console.log('🚀 Manual Integration Test');
	console.log('=' .repeat(50));
	
	const config = {
		paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL,
		apiKey: process.env.MASUMI_API_KEY,
		agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER,
		network: process.env.MASUMI_NETWORK || 'Preprod',
		sellerVkey: process.env.MASUMI_SELLER_VKEY,
	};
	
	// validate environment variables
	const requiredEnvVars = ['paymentServiceUrl', 'apiKey', 'agentIdentifier', 'sellerVkey'];
	const missing = requiredEnvVars.filter(env => !config[env]);
	if (missing.length > 0) {
		console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
		process.exit(1);
	}
	
	console.log('🔧 Configuration:');
	console.log(`   Service URL: ${config.paymentServiceUrl}`);
	console.log(`   Network: ${config.network}`);
	console.log(`   Agent: ${config.agentIdentifier.substring(0, 20)}...`);
	console.log('');
	
	try {
		// test 1: payment creation
		console.log('🧪 1. Testing payment creation...');
		const testInput = { 
			manual: 'integration test', 
			timestamp: new Date().toISOString() 
		};
		const paymentData = preparePaymentData(testInput);
		const paymentResponse = await createPayment(config, paymentData);
		
		console.log('✅ Payment created successfully!');
		console.log(`   Blockchain ID: ${paymentResponse.data.blockchainIdentifier?.substring(0, 30)}...`);
		console.log(`   Pay by time: ${paymentResponse.data.payByTime}`);
		
		// test 2: status check
		console.log('\n🧪 2. Testing status check...');
		const status = await checkPaymentStatus(config, paymentResponse.data.blockchainIdentifier);
		
		console.log(`✅ Status check completed: ${status ? 'found' : 'not found'}`);
		if (status) {
			console.log(`   On-chain state: ${status.onChainState || 'pending'}`);
		}
		
		console.log('\n' + '='.repeat(50));
		console.log('✅ Manual integration test completed successfully!');
		console.log('💡 All API calls working correctly');
		
	} catch (error) {
		console.error('\n' + '='.repeat(50));
		console.error('❌ Manual integration test failed:', error.message);
		console.log('💡 This could be due to API key, network issues, or service unavailability');
		process.exit(1);
	}
}

runManualIntegrationTest();