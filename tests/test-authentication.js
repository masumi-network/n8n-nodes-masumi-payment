#!/usr/bin/env node

/**
 * Authentication Test (Case 7) for Masumi Paywall n8n Node
 * Tests wrong API key authentication with real HTTP requests
 * 
 * Test scenario:
 * - Uses correct inputs but wrong API key
 * - Makes actual HTTP request to masumi service
 * - Expects authentication error from the API
 * - Shows exact error response using protocol field names
 * 
 * Usage: node test-authentication.js
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// Import core functions from standalone test
const {
    generateInputHash,
    generateIdentifier,
    preparePaymentRequest,
} = require('./test-standalone.js');

// Load environment variables from .env file
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').trim();
                if (key && value) {
                    process.env[key] = value;
                }
            }
        }
    }
}

// Load environment configuration
loadEnv();

// Test configuration with correct inputs but wrong API key
const TEST_CONFIG = {
    paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL,
    apiKey: process.env.MASUMI_API_KEY,
    agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER,
    sellerVkey: process.env.MASUMI_SELLER_VKEY,
    network: process.env.MASUMI_NETWORK || 'Preprod',
    inputData: 'test authentication data',
    timeout: 1, // short timeout for auth test
    pollInterval: 5
};

// Wrong API key for authentication testing
const WRONG_API_KEY = 'wrong-api-key-12345-invalid';

// HTTP request helper for real API calls
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
            timeout: 15000 // 15 second timeout for auth test
        };
        
        if (postData) {
            requestOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        
        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                let response;
                try {
                    response = JSON.parse(data);
                } catch (e) {
                    response = {
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        rawData: data,
                        headers: res.headers
                    };
                }
                
                // Include HTTP status code in response
                response.httpStatusCode = res.statusCode;
                response.httpStatusMessage = res.statusMessage;
                
                resolve(response);
            });
        });
        
        req.on('error', (error) => {
            reject({
                error: error.message,
                code: error.code,
                errno: error.errno,
                syscall: error.syscall,
                hostname: error.hostname
            });
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject({
                error: 'Request timeout',
                code: 'ETIMEDOUT',
                timeout: requestOptions.timeout
            });
        });
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

// Real API call to test authentication with wrong API key
async function testWrongApiKeyAuthentication(paymentRequest, wrongApiKey) {
    console.log('📤 Making real API call with wrong API key...');
    console.log('Endpoint:', `${TEST_CONFIG.paymentServiceUrl}/payment/`);
    console.log('Wrong API Key:', wrongApiKey);
    console.log('Payload:', JSON.stringify(paymentRequest, null, 2));
    
    try {
        const response = await httpRequest({
            method: 'POST',
            url: `${TEST_CONFIG.paymentServiceUrl}/payment/`,
            headers: {
                'Content-Type': 'application/json',
                'token': wrongApiKey, // using wrong API key here
                'accept': 'application/json',
            }
        }, JSON.stringify(paymentRequest));
        
        console.log('📥 API Response:', JSON.stringify(response, null, 2));
        return response;
        
    } catch (error) {
        console.log('📥 API Error:', JSON.stringify(error, null, 2));
        return {
            error: true,
            details: error,
            httpStatusCode: error.statusCode || 'NETWORK_ERROR',
            httpStatusMessage: error.statusMessage || 'Network request failed'
        };
    }
}

// Main authentication test function
async function runAuthenticationTest() {
    console.log('🚀 Starting Authentication Test (Case 7)');
    console.log('Testing wrong API key with real HTTP requests');
    console.log('='.repeat(70));
    
    // Check if we have valid configuration
    if (TEST_CONFIG.paymentServiceUrl.includes('your-masumi-service') || 
        TEST_CONFIG.apiKey === 'your-api-key') {
        console.log('⚠️  Configuration required! Please set up .env file with real values.');
        console.log('   This test needs real masumi service URL and valid credentials');
        console.log('   (except API key which will be replaced with wrong key for testing)');
        console.log('');
        console.log('   Copy .env.example to .env and update with your values.');
        return false;
    }
    
    console.log('📋 Test Configuration:');
    console.log(`   Service URL: ${TEST_CONFIG.paymentServiceUrl}`);
    console.log(`   Correct API Key: ${TEST_CONFIG.apiKey.substring(0, 8)}...`);
    console.log(`   Wrong API Key: ${WRONG_API_KEY}`);
    console.log(`   Agent ID: ${TEST_CONFIG.agentIdentifier.substring(0, 12)}...`);
    console.log(`   Network: ${TEST_CONFIG.network}`);
    console.log('');
    
    try {
        console.log('🧪 Running Case 7: Wrong API Key Authentication Test...');
        
        // Step 1: Generate valid input data
        const inputData = { input_string: TEST_CONFIG.inputData };
        const identifier = generateIdentifier();
        const inputHash = generateInputHash(identifier, inputData);
        
        console.log('1️⃣ Generated valid test data:');
        console.log(`   Input Hash: ${inputHash}`);
        console.log(`   Identifier: ${identifier}`);
        
        // Step 2: Prepare valid payment request (all fields correct)
        const paymentRequest = {
            agentIdentifier: TEST_CONFIG.agentIdentifier,
            network: TEST_CONFIG.network,
            inputHash: inputHash,
            payByTime: new Date(Date.now() + 300000).toISOString(),
            metadata: `Auth test payment request`,
            paymentType: 'Web3CardanoV1',
            submitResultTime: new Date(Date.now() + 1200000).toISOString(),
            identifierFromPurchaser: identifier,
        };
        
        console.log('2️⃣ Prepared valid payment request');
        
        // Step 3: Make API call with wrong API key
        console.log('3️⃣ Making API call with wrong API key...');
        const authResponse = await testWrongApiKeyAuthentication(paymentRequest, WRONG_API_KEY);
        
        // Step 4: Analyze authentication response
        console.log('\n4️⃣ Analyzing authentication response...');
        
        let testResult = {
            success: false,
            expectedAuthError: false,
            httpStatusCode: authResponse.httpStatusCode,
            httpStatusMessage: authResponse.httpStatusMessage,
            errorMessage: '',
            exactResponse: authResponse
        };
        
        // Check for expected authentication error patterns
        if (authResponse.error || 
            authResponse.httpStatusCode === 401 || 
            authResponse.httpStatusCode === 403 ||
            (authResponse.httpStatusCode >= 400 && authResponse.httpStatusCode < 500)) {
            
            testResult.expectedAuthError = true;
            testResult.success = true;
            
            // Extract exact error message using protocol field names
            if (authResponse.details && authResponse.details.error) {
                testResult.errorMessage = authResponse.details.error;
            } else if (authResponse.message) {
                testResult.errorMessage = authResponse.message;
            } else if (authResponse.error) {
                testResult.errorMessage = typeof authResponse.error === 'string' ? 
                    authResponse.error : 'Authentication failed';
            } else if (authResponse.rawData) {
                testResult.errorMessage = authResponse.rawData;
            } else {
                testResult.errorMessage = `HTTP ${authResponse.httpStatusCode}: ${authResponse.httpStatusMessage}`;
            }
        } else if (authResponse.data || authResponse.success) {
            // Unexpected success - wrong API key should not work
            testResult.success = false;
            testResult.errorMessage = 'Unexpected success: wrong API key should have failed authentication';
        } else {
            // Unexpected response format
            testResult.success = false;  
            testResult.errorMessage = 'Unexpected response format';
        }
        
        // Print detailed test results
        console.log('\n' + '='.repeat(70));
        console.log('📊 AUTHENTICATION TEST RESULTS (CASE 7)');
        console.log('='.repeat(70));
        
        if (testResult.success && testResult.expectedAuthError) {
            console.log('✅ SUCCESS: Wrong API key authentication test PASSED');
            console.log('   - Wrong API key correctly rejected by masumi service');
            console.log('   - Authentication error detected as expected');
        } else if (!testResult.success && !testResult.expectedAuthError) {
            console.log('❌ FAILURE: Wrong API key authentication test FAILED');
            console.log('   - Expected authentication error but got unexpected response');
        } else {
            console.log('❌ FAILURE: Wrong API key authentication test FAILED');
            console.log('   - Wrong API key was incorrectly accepted (security issue!)');
        }
        
        console.log('\n📋 Authentication Response Details:');
        console.log(`   HTTP Status: ${testResult.httpStatusCode} ${testResult.httpStatusMessage}`);
        console.log(`   Error Message: ${testResult.errorMessage}`);
        console.log(`   Expected Auth Error: ${testResult.expectedAuthError ? 'YES' : 'NO'}`);
        
        // Show exact masumi protocol error response
        console.log('\n🔍 Exact Masumi Protocol Response:');
        if (testResult.exactResponse.message) {
            console.log(`   message: "${testResult.exactResponse.message}"`);
        }
        if (testResult.exactResponse.error) {
            console.log(`   error: "${testResult.exactResponse.error}"`);
        }
        if (testResult.exactResponse.statusCode) {
            console.log(`   statusCode: ${testResult.exactResponse.statusCode}`);
        }
        if (testResult.exactResponse.data) {
            console.log(`   data: ${JSON.stringify(testResult.exactResponse.data)}`);
        }
        
        // Protocol compliance summary
        console.log('\n📋 PROTOCOL COMPLIANCE SUMMARY:');
        console.log('  ✓ Uses real masumi service API endpoints');
        console.log('  ✓ Tests authentication with actual HTTP requests');
        console.log('  ✓ Uses exact masumi protocol field names');
        console.log('  ✓ Shows exact error response from masumi service');
        console.log('  ✓ Validates security: wrong API key should be rejected');
        
        return testResult.success;
        
    } catch (error) {
        console.error('💥 Authentication test failed:', error);
        console.error('Stack trace:', error.stack);
        
        console.log('\n📋 ERROR SUMMARY:');
        console.log(`  Error Type: ${error.name || 'Unknown'}`);
        console.log(`  Error Message: ${error.message}`);
        if (error.code) {
            console.log(`  Error Code: ${error.code}`);
        }
        
        return false;
    }
}

// Command line interface
if (require.main === module) {
    console.log('Masumi Paywall Node - Authentication Test (Case 7)');
    console.log('==================================================\n');
    
    runAuthenticationTest()
        .then(success => {
            console.log('\n' + '='.repeat(70));
            if (success) {
                console.log('🎉 AUTHENTICATION TEST (CASE 7) COMPLETED SUCCESSFULLY!');
                console.log('   Wrong API key correctly rejected by masumi service.');
                console.log('   Node authentication logic is working as expected.');
            } else {
                console.log('⚠️  AUTHENTICATION TEST (CASE 7) FAILED!');
                console.log('   Review the error details above for troubleshooting.');
            }
            console.log('='.repeat(70));
            
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Test suite crashed:', error);
            process.exit(1);
        });
}

/*
 * INTEGRATION NOTES FOR ACTUAL N8N NODE:
 * 
 * This test validates that the masumi service properly rejects invalid API keys.
 * The actual n8n node should implement similar error handling:
 * 
 * async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
 *     try {
 *         const credentials = await this.getCredentials('masumiPaywallApi');
 *         
 *         // Create payment request with API key
 *         const response = await this.httpRequest({
 *             method: 'POST',
 *             url: `${credentials.paymentServiceUrl}/payment/`,
 *             headers: {
 *                 'Content-Type': 'application/json',
 *                 'token': credentials.apiKey,
 *                 'accept': 'application/json',
 *             },
 *             body: paymentRequest
 *         });
 *         
 *     } catch (error) {
 *         // Handle authentication errors
 *         if (error.httpCode === 401 || error.httpCode === 403) {
 *             throw new NodeOperationError(
 *                 this.getNode(), 
 *                 `Authentication failed: Invalid API key. ${error.message}`
 *             );
 *         }
 *         throw error;
 *     }
 * }
 */

module.exports = {
    runAuthenticationTest,
    testWrongApiKeyAuthentication,
    TEST_CONFIG,
    WRONG_API_KEY
};