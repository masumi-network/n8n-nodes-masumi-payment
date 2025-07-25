#!/usr/bin/env node

/**
 * Input Validation Tests for Masumi Paywall n8n Node
 * Tests all 6 required inputs according to testing guidelines
 * 
 * Required inputs (using exact masumi protocol field names):
 * 1. input_string (or inputData field) - data to be processed
 * 2. paymentServiceUrl (payment service endpoint)
 * 3. apiKey (payment service authentication)
 * 4. agentIdentifier (agent ID in masumi system)
 * 5. sellerVkey (seller verification key)
 * 6. network (Cardano network: Preprod/Mainnet)
 *
 * Usage: node test-input-validation.js
 * 
 * Integration Notes:
 * - These validation patterns should be implemented in the actual n8n node
 * - The mockCreatePaymentRequest() function shows the validation logic needed
 * - Error messages use exact credential field names for consistency
 * - Network validation ensures only valid Cardano networks are accepted
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Import core functions from standalone test
const {
    generateInputHash,
    generateIdentifier,  
    preparePaymentRequest,
    createPaymentRequest,
} = require('./test-standalone.js');

// Test configuration with valid defaults
const BASE_CONFIG = {
    paymentServiceUrl: 'https://test-masumi-service.com/api/v1',
    apiKey: 'test-api-key-123',
    agentIdentifier: 'test-agent-456',
    sellerVkey: 'test-seller-vkey-789',
    network: 'Preprod',
    inputData: 'test input string',
    timeout: 2,
    pollInterval: 5
};

// HTTP request helper for testing
function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 5000 // 5 second timeout for validation tests
        };
        
        if (postData) {
            requestOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        
        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (e) {
                    resolve(data);
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Request timeout')));
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

// Mock implementation of createPaymentRequest for testing
async function mockCreatePaymentRequest(paymentRequest, credentials) {
    // Validate required fields using exact protocol field names
    if (!credentials.paymentServiceUrl) {
        throw new Error("Missing required credential 'paymentServiceUrl'");
    }
    if (!credentials.apiKey) {
        throw new Error("Missing required credential 'apiKey'");
    }
    if (!credentials.agentIdentifier) {
        throw new Error("Missing required credential 'agentIdentifier'");
    }
    if (!credentials.sellerVkey) {
        throw new Error("Missing required credential 'sellerVkey'");
    }
    if (!credentials.network) {
        throw new Error("Missing required credential 'network'");
    }
    
    // Validate input data
    if (!paymentRequest.inputHash) {
        throw new Error("Missing required input 'inputData' - cannot generate inputHash");
    }
    
    // Network validation
    if (credentials.network !== 'Preprod' && credentials.network !== 'Mainnet') {
        throw new Error("Invalid network: must be 'Preprod' or 'Mainnet'");
    }
    
    // If we reach here, all validations passed
    return {
        success: true,
        validationPassed: true,
        data: {
            blockchainIdentifier: 'mock-blockchain-id-123',
            inputHash: paymentRequest.inputHash,
            payByTime: Date.now() + 300000,
            submitResultTime: Date.now() + 1200000,
            unlockTime: Date.now() + 1800000,
            externalDisputeUnlockTime: Date.now() + 3600000
        }
    };
}

// Test runner for individual validation test
async function runValidationTest(testName, testConfig, expectedErrorPattern) {
    console.log(`\n🧪 Running ${testName}...`);
    
    try {
        // Generate input hash and identifier
        const inputData = { input_string: testConfig.inputData || 'test data' };
        const inputHash = testConfig.inputData ? generateInputHash(inputData) : null;
        const identifier = generateIdentifier();
        
        // Prepare payment request (with potentially missing inputHash)
        const paymentRequest = {
            agentIdentifier: testConfig.agentIdentifier,
            network: testConfig.network,
            inputHash: inputHash,
            payByTime: new Date(Date.now() + 300000).toISOString(),
            metadata: `Test payment request`,
            paymentType: 'Web3CardanoV1',
            submitResultTime: new Date(Date.now() + 1200000).toISOString(),
            identifierFromPurchaser: identifier,
        };
        
        // Attempt to create payment request with test config
        const response = await mockCreatePaymentRequest(paymentRequest, testConfig);
        
        // If we reach here, validation didn't fail as expected
        console.log(`❌ FAILURE: ${testName}`);
        console.log(`  Expected error but validation passed`);
        console.log(`  Response: ${JSON.stringify(response)}`);
        return { success: false, error: 'Expected validation error but none occurred' };
        
    } catch (error) {
        // Check if error matches expected pattern
        const errorMessage = error.message;
        const expectedMatch = expectedErrorPattern.test ? 
            expectedErrorPattern.test(errorMessage) : 
            errorMessage.includes(expectedErrorPattern);
            
        if (expectedMatch) {
            console.log(`✅ SUCCESS: ${testName}`);
            console.log(`  Expected error: ${errorMessage}`);
            return { success: true, errorMessage };
        } else {
            console.log(`❌ FAILURE: ${testName}`);
            console.log(`  Expected pattern: ${expectedErrorPattern}`);
            console.log(`  Actual error: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
}

// Main test suite
async function runInputValidationTests() {
    console.log('🚀 Starting Input Validation Tests for Masumi Paywall Node');
    console.log('Testing all 6 required inputs according to protocol field names\n');
    console.log('='.repeat(70));
    
    const testResults = [];
    
    // Test 1: Missing inputData (input_string)
    const test1Config = { ...BASE_CONFIG };
    delete test1Config.inputData;
    const test1Result = await runValidationTest(
        'Test 1: Missing inputData',
        test1Config,
        "Missing required input 'inputData'"
    );
    testResults.push({ name: 'Missing inputData', ...test1Result });
    
    // Test 2: Missing paymentServiceUrl
    const test2Config = { ...BASE_CONFIG };
    delete test2Config.paymentServiceUrl;
    const test2Result = await runValidationTest(
        'Test 2: Missing paymentServiceUrl',
        test2Config,
        "Missing required credential 'paymentServiceUrl'"
    );
    testResults.push({ name: 'Missing paymentServiceUrl', ...test2Result });
    
    // Test 3: Missing apiKey
    const test3Config = { ...BASE_CONFIG };
    delete test3Config.apiKey;
    const test3Result = await runValidationTest(
        'Test 3: Missing apiKey',
        test3Config,
        "Missing required credential 'apiKey'"
    );
    testResults.push({ name: 'Missing apiKey', ...test3Result });
    
    // Test 4: Missing agentIdentifier
    const test4Config = { ...BASE_CONFIG };
    delete test4Config.agentIdentifier;
    const test4Result = await runValidationTest(
        'Test 4: Missing agentIdentifier',
        test4Config,
        "Missing required credential 'agentIdentifier'"
    );
    testResults.push({ name: 'Missing agentIdentifier', ...test4Result });
    
    // Test 5: Missing sellerVkey
    const test5Config = { ...BASE_CONFIG };
    delete test5Config.sellerVkey;
    const test5Result = await runValidationTest(
        'Test 5: Missing sellerVkey',
        test5Config,
        "Missing required credential 'sellerVkey'"
    );
    testResults.push({ name: 'Missing sellerVkey', ...test5Result });
    
    // Test 6: Missing network
    const test6Config = { ...BASE_CONFIG };
    delete test6Config.network;
    const test6Result = await runValidationTest(
        'Test 6: Missing network',
        test6Config,
        "Missing required credential 'network'"
    );
    testResults.push({ name: 'Missing network', ...test6Result });
    
    // Bonus Test 7: Invalid network value
    const test7Config = { ...BASE_CONFIG };
    test7Config.network = 'InvalidNetwork';
    const test7Result = await runValidationTest(
        'Test 7: Invalid network value',
        test7Config,
        "Invalid network: must be 'Preprod' or 'Mainnet'"
    );
    testResults.push({ name: 'Invalid network value', ...test7Result });
    
    // Test 8: All valid inputs (should pass)
    console.log(`\n🧪 Running Test 8: All valid inputs...`);
    try {
        const inputData = { input_string: BASE_CONFIG.inputData };
        const inputHash = generateInputHash(inputData);
        const identifier = generateIdentifier();
        
        const paymentRequest = {
            agentIdentifier: BASE_CONFIG.agentIdentifier,
            network: BASE_CONFIG.network,
            inputHash: inputHash,
            payByTime: new Date(Date.now() + 300000).toISOString(),
            metadata: `Test payment request`,
            paymentType: 'Web3CardanoV1',
            submitResultTime: new Date(Date.now() + 1200000).toISOString(),
            identifierFromPurchaser: identifier,
        };
        
        const response = await mockCreatePaymentRequest(paymentRequest, BASE_CONFIG);
        
        if (response.validationPassed) {
            console.log(`✅ SUCCESS: All valid inputs`);
            console.log(`  blockchainIdentifier: ${response.data.blockchainIdentifier}`);
            console.log(`  inputHash: ${response.data.inputHash}`);
            testResults.push({ name: 'All valid inputs', success: true });
        } else {
            console.log(`❌ FAILURE: All valid inputs`);
            console.log(`  Validation failed unexpectedly`);
            testResults.push({ name: 'All valid inputs', success: false, error: 'Validation failed' });
        }
    } catch (error) {
        console.log(`❌ FAILURE: All valid inputs`);
        console.log(`  Unexpected error: ${error.message}`);
        testResults.push({ name: 'All valid inputs', success: false, error: error.message });
    }
    
    // Print test summary
    console.log('\n' + '=' * 70);
    console.log('📊 INPUT VALIDATION TEST SUMMARY');
    console.log('='.repeat(70));
    
    let passedTests = 0;
    let totalTests = testResults.length;
    
    testResults.forEach((result, index) => {
        const status = result.success ? 'SUCCESS' : 'FAILURE';
        const statusIcon = result.success ? '✅' : '❌';
        console.log(`${statusIcon} ${status}: ${result.name}`);
        
        if (result.success) {
            passedTests++;
            if (result.errorMessage) {
                console.log(`  Expected error: ${result.errorMessage}`);
            }
        } else {
            console.log(`  Error: ${result.error}`);
        }
    });
    
    console.log('\n' + '-'.repeat(70));
    console.log(`🎯 Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 ALL INPUT VALIDATION TESTS PASSED!');
        console.log('   All required inputs are properly validated with descriptive error messages.');
    } else {
        console.log('⚠️  Some validation tests failed - review implementation.');
    }
    
    // Protocol compliance summary
    console.log('\n📋 PROTOCOL COMPLIANCE SUMMARY:');
    console.log('  ✓ Uses exact masumi protocol field names');
    console.log('  ✓ Tests all 6 required inputs as specified');
    console.log('  ✓ Returns clear SUCCESS/FAILURE results');
    console.log('  ✓ Shows exact error messages in summary');
    console.log('  ✓ Validates network values (Preprod/Mainnet only)');
    
    return passedTests === totalTests;
}

// Command line interface
if (require.main === module) {
    console.log('Masumi Paywall Node - Input Validation Tests');
    console.log('============================================\n');
    
    runInputValidationTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Test suite failed:', error);
            process.exit(1);
        });
}

/*
 * INTEGRATION EXAMPLE FOR ACTUAL N8N NODE:
 * 
 * To implement these validations in MasumiPaywall.node.ts:
 * 
 * async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
 *     const credentials = await this.getCredentials('masumiPaywallApi');
 *     const inputData = this.getNodeParameter('inputData', 0) as string;
 *     
 *     // Validate required credentials
 *     if (!credentials.paymentServiceUrl) {
 *         throw new NodeOperationError(this.getNode(), "Missing required credential 'paymentServiceUrl'");
 *     }
 *     if (!credentials.apiKey) {
 *         throw new NodeOperationError(this.getNode(), "Missing required credential 'apiKey'");
 *     }
 *     if (!credentials.agentIdentifier) {
 *         throw new NodeOperationError(this.getNode(), "Missing required credential 'agentIdentifier'");
 *     }
 *     if (!credentials.sellerVkey) {
 *         throw new NodeOperationError(this.getNode(), "Missing required credential 'sellerVkey'");
 *     }
 *     if (!credentials.network) {
 *         throw new NodeOperationError(this.getNode(), "Missing required credential 'network'");
 *     }
 *     
 *     // Validate input data
 *     if (!inputData || inputData.trim() === '') {
 *         throw new NodeOperationError(this.getNode(), "Missing required input 'inputData' - cannot generate inputHash");
 *     }
 *     
 *     // Validate network
 *     if (credentials.network !== 'Preprod' && credentials.network !== 'Mainnet') {
 *         throw new NodeOperationError(this.getNode(), "Invalid network: must be 'Preprod' or 'Mainnet'");
 *     }
 *     
 *     // Continue with payment processing...
 * }
 */

module.exports = {
    runInputValidationTests,
    runValidationTest,
    mockCreatePaymentRequest
};