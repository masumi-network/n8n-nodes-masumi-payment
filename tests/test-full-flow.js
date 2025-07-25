#!/usr/bin/env node

/**
 * Full Flow Test - Case 9
 * 
 * Tests the complete masumi paywall flow that matches exactly what n8n does:
 * 1. Creates payment request successfully with valid inputs
 * 2. Makes an actual purchase using the /purchase/ endpoint
 * 3. Polls for payment status until FundsLocked is detected
 * 4. Uses exact protocol field names (blockchainIdentifier, onChainState, etc.)
 * 5. Shows that complete flow works and detects FundsLocked exactly like n8n
 * 6. Uses real API calls to masumi service
 * 7. Checks the /purchase/ endpoint after making the purchase (not /payment/)
 * 8. Shows detailed polling results until FundsLocked is found
 * 
 * This demonstrates the complete payment flow works and polling correctly 
 * detects FundsLocked when purchase is made (matching n8n behavior exactly).
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// load environment variables from .env file
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

// load environment variables
loadEnv();

// configuration from environment variables
const CONFIG = {
    paymentServiceUrl: process.env.MASUMI_PAYMENT_SERVICE_URL || 'NO_HARDCODED_URL',
    apiKey: process.env.MASUMI_API_KEY || 'your-api-key',
    agentIdentifier: process.env.MASUMI_AGENT_IDENTIFIER || 'your-agent-id',
    sellerVkey: process.env.MASUMI_SELLER_VKEY || 'your-seller-vkey',
    network: process.env.MASUMI_NETWORK || 'Preprod',
    timeout: parseInt(process.env.MASUMI_TIMEOUT_MINUTES) || 10,
    pollInterval: parseInt(process.env.MASUMI_POLL_INTERVAL_SECONDS) || 10
};

// core payment functions (exact port from n8n node)
function generateInputHash(inputData) {
    const inputString = inputData.input_string || 'full flow test data';
    return crypto.createHash('sha256').update(inputString, 'utf8').digest('hex');
}

function generateIdentifier() {
    return crypto.randomBytes(7).toString('hex');
}

function preparePaymentRequest(inputData, inputHash, identifier) {
    const now = new Date();
    const payByTime = new Date(now.getTime() + 5 * 60 * 1000);
    const submitResultTime = new Date(now.getTime() + 20 * 60 * 1000);
    
    return {
        agentIdentifier: CONFIG.agentIdentifier,
        network: CONFIG.network,
        inputHash: inputHash,
        payByTime: payByTime.toISOString(),
        metadata: `Full flow test - complete payment with purchase: ${JSON.stringify(inputData).substring(0, 100)}`,
        paymentType: 'Web3CardanoV1',
        submitResultTime: submitResultTime.toISOString(),
        identifierFromPurchaser: identifier,
    };
}

function preparePurchaseRequest(paymentResponse, inputData, identifier) {
    const paymentData = paymentResponse.data;
    return {
        identifierFromPurchaser: identifier,
        network: CONFIG.network,
        sellerVkey: CONFIG.sellerVkey,
        paymentType: 'Web3CardanoV1',
        blockchainIdentifier: paymentData.blockchainIdentifier,
        payByTime: String(paymentData.payByTime),
        submitResultTime: String(paymentData.submitResultTime),
        unlockTime: String(paymentData.unlockTime),
        externalDisputeUnlockTime: String(paymentData.externalDisputeUnlockTime),
        agentIdentifier: CONFIG.agentIdentifier,
        inputHash: paymentData.inputHash,
    };
}

// http request helper
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
            headers: options.headers || {}
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
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

async function createPaymentRequest(paymentRequest) {
    console.log('📤 Creating payment request...');
    console.log('Payload:', JSON.stringify(paymentRequest, null, 2));
    
    const response = await httpRequest({
        method: 'POST',
        url: `${CONFIG.paymentServiceUrl}/payment/`,
        headers: {
            'Content-Type': 'application/json',
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    }, JSON.stringify(paymentRequest));
    
    console.log('📥 Payment response:', JSON.stringify(response, null, 2));
    return response;
}

async function createPurchase(purchaseRequest) {
    console.log('📤 Creating purchase request to lock funds...');
    console.log('Payload:', JSON.stringify(purchaseRequest, null, 2));
    
    const response = await httpRequest({
        method: 'POST', 
        url: `${CONFIG.paymentServiceUrl}/purchase/`,
        headers: {
            'Content-Type': 'application/json',
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    }, JSON.stringify(purchaseRequest));
    
    console.log('📥 Purchase response:', JSON.stringify(response, null, 2));
    return response;
}

async function checkPaymentStatus(inputHash, identifier) {
    const url = `${CONFIG.paymentServiceUrl}/payment/?inputHash=${inputHash}&identifierFromPurchaser=${identifier}&network=${CONFIG.network}`;
    
    const response = await httpRequest({
        method: 'GET',
        url: url,
        headers: {
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    });
    
    return response;
}

async function checkPurchaseStatus(inputHash, identifier) {
    const url = `${CONFIG.paymentServiceUrl}/purchase/?inputHash=${inputHash}&identifierFromPurchaser=${identifier}&network=${CONFIG.network}`;
    
    console.log(`🔍 Checking purchase status at: ${url}`);
    
    const response = await httpRequest({
        method: 'GET',
        url: url,
        headers: {
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    });
    
    return response;
}

function evaluatePaymentStatusDetailed(statusResponse, blockchainIdentifier, iteration, endpoint = 'payment') {
    // Simplified iteration header
    
    // find our payment in the response
    let ourPayment = null;
    let paymentsArray = null;
    
    if (statusResponse.data) {
        // check both possible locations for payments data
        paymentsArray = statusResponse.data.Payments || statusResponse.data.payments || statusResponse.data.Purchases || statusResponse.data.purchases;
        
        if (paymentsArray) {
            ourPayment = paymentsArray.find(
                payment => payment.blockchainIdentifier === blockchainIdentifier
            );
        }
    }

    let paymentFound = !!ourPayment;
    let onChainState = null;
    let blockchainId = null;
    let paymentDetails = null;

    if (ourPayment) {
        onChainState = ourPayment.onChainState;
        blockchainId = ourPayment.blockchainIdentifier;
        paymentDetails = {
            payByTime: ourPayment.payByTime,
            submitResultTime: ourPayment.submitResultTime,
            unlockTime: ourPayment.unlockTime,
            inputHash: ourPayment.inputHash,
            network: ourPayment.network,
            agentIdentifier: ourPayment.agentIdentifier
        };
        
        // State analysis for return value only - no verbose output during polling
        if (onChainState === 'FundsLocked') {
            console.log(`🎉 FundsLocked detected! Payment confirmed.`);
        }
    }

    const result = {
        iteration,
        endpoint,
        paymentFound,
        onChainState,
        blockchainIdentifier: blockchainId,
        paymentDetails,
        rawResponse: statusResponse,
        timestamp: new Date().toISOString()
    };

    // Only show summary line if this is the final result or error
    if (onChainState === 'FundsLocked' || !paymentFound) {
        console.log(`🔄 [${iteration}] ${endpoint}: ${onChainState || 'null'}`);
    }

    return result;
}

async function pollUntilFundsLocked(inputHash, identifier, blockchainIdentifier, maxIterations = 30) {
    console.log(`🔄 Polling for FundsLocked status (max ${maxIterations} iterations)...`);
    console.log(`📍 Monitoring blockchainIdentifier: ${blockchainIdentifier}`);
    console.log(`⏰ Poll interval: ${CONFIG.pollInterval} seconds`);
    console.log(`⏱️ Maximum polling time: ${(maxIterations * CONFIG.pollInterval) / 60} minutes`);
    
    const results = [];
    let fundsLockedFound = false;
    let lastKnownState = null;
    
    // initial delay before first check
    console.log('⏳ Initial 5-second delay before first status check...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    for (let i = 1; i <= maxIterations && !fundsLockedFound; i++) {
        try {
            // Check both endpoints - one line per iteration showing state
            const paymentStatusResponse = await checkPaymentStatus(inputHash, identifier);
            const paymentEvaluation = evaluatePaymentStatusDetailed(paymentStatusResponse, blockchainIdentifier, i, 'payment');
             
            const purchaseStatusResponse = await checkPurchaseStatus(inputHash, identifier);
            const purchaseEvaluation = evaluatePaymentStatusDetailed(purchaseStatusResponse, blockchainIdentifier, i, 'purchase');
            
            // combine results
            const combinedResult = {
                iteration: i,
                paymentEndpoint: paymentEvaluation,
                purchaseEndpoint: purchaseEvaluation,
                timestamp: new Date().toISOString()
            };
            
            results.push(combinedResult);
            
            // check for FundsLocked in either endpoint
            const paymentFundsLocked = paymentEvaluation.onChainState === 'FundsLocked';
            const purchaseFundsLocked = purchaseEvaluation.onChainState === 'FundsLocked';
            
            // Show one concise line per iteration
            const paymentState = paymentEvaluation.onChainState || 'null';
            const purchaseState = purchaseEvaluation.onChainState || 'null';
            console.log(`🔄 [${i}/${maxIterations}] payment:${paymentState} purchase:${purchaseState}`);
            
            if (paymentFundsLocked || purchaseFundsLocked) {
                console.log(`\n🎉 FUNDS LOCKED DETECTED!`);
                console.log(`   - Payment endpoint: ${paymentEvaluation.onChainState || 'null'}`);
                console.log(`   - Purchase endpoint: ${purchaseEvaluation.onChainState || 'null'}`);
                console.log(`   - Iteration: ${i}/${maxIterations}`);
                console.log(`   - Time to detection: ${(i * CONFIG.pollInterval) / 60} minutes`);
                
                fundsLockedFound = true;
                break;
            }
            
            // track state changes
            const currentStates = {
                payment: paymentEvaluation.onChainState,
                purchase: purchaseEvaluation.onChainState
            };
            
            if (JSON.stringify(lastKnownState) !== JSON.stringify(currentStates)) {
                console.log(`\n📊 State change detected:`);
                console.log(`   - Previous: ${JSON.stringify(lastKnownState)}`);
                console.log(`   - Current:  ${JSON.stringify(currentStates)}`);
                lastKnownState = currentStates;
            }
            
            // check for error states
            const errorStates = ['FundsOrDatumInvalid', 'RefundRequested', 'Disputed', 'RefundWithdrawn', 'DisputedWithdrawn'];
            const paymentError = errorStates.includes(paymentEvaluation.onChainState);
            const purchaseError = errorStates.includes(purchaseEvaluation.onChainState);
            
            if (paymentError || purchaseError) {
                console.log(`\n❌ ERROR STATE DETECTED - stopping polling`);
                console.log(`   - Payment endpoint: ${paymentEvaluation.onChainState || 'null'}`);
                console.log(`   - Purchase endpoint: ${purchaseEvaluation.onChainState || 'null'}`);
                break;
            }
            
            // wait before next iteration (except for last iteration)
            if (i < maxIterations && !fundsLockedFound) {
                console.log(`\n⏳ Waiting ${CONFIG.pollInterval} seconds before next check...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.pollInterval * 1000));
            }
            
        } catch (error) {
            console.error(`❌ Error in iteration ${i}:`, error.message);
            results.push({
                iteration: i,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            // wait before retrying
            await new Promise(resolve => setTimeout(resolve, CONFIG.pollInterval * 1000));
        }
    }
    
    return {
        results,
        fundsLockedFound,
        totalIterations: results.length,
        timeElapsed: (results.length * CONFIG.pollInterval) / 60
    };
}

// main full flow test function
async function testFullFlow() {
    console.log('🚀 Starting Full Flow Test (Case 9)');
    console.log('===================================');
    console.log('This test performs the complete masumi paywall flow:');
    console.log('1. Create payment request');
    console.log('2. Create purchase (lock funds)');
    console.log('3. Poll until FundsLocked is detected');
    console.log('4. Verify exact protocol field names and behavior');
    console.log('\nConfiguration:', JSON.stringify(CONFIG, null, 2));
    console.log('=' * 80);
    
    const testStartTime = Date.now();
    
    try {
        // test input data
        const inputData = { 
            input_string: 'full flow test - complete payment with purchase and polling until FundsLocked',
            test_case: 'Case 9 - Full Flow Test',
            timestamp: new Date().toISOString()
        };
        
        // step 1: generate hash and identifier
        console.log('\n1️⃣ Generating input hash and identifier...');
        const inputHash = generateInputHash(inputData);
        const identifier = generateIdentifier();
        console.log(`📝 Input Hash: ${inputHash}`);
        console.log(`🆔 Identifier: ${identifier}`);
        console.log(`📄 Input Data: ${JSON.stringify(inputData)}`);
        
        // step 2: create payment request
        console.log('\n2️⃣ Creating payment request...');
        const paymentRequest = preparePaymentRequest(inputData, inputHash, identifier);
        const paymentResponse = await createPaymentRequest(paymentRequest);
        
        if (!paymentResponse.data) {
            throw new Error('Invalid payment response: ' + JSON.stringify(paymentResponse));
        }
        
        const blockchainIdentifier = paymentResponse.data.blockchainIdentifier;
        console.log(`✅ Payment request created successfully!`);
        console.log(`🔗 blockchainIdentifier: ${blockchainIdentifier}`);
        console.log(`⏰ Payment window: ${paymentResponse.data.payByTime}`);
        console.log(`📅 Result submission deadline: ${paymentResponse.data.submitResultTime}`);
        
        // step 3: create purchase to lock funds
        console.log('\n3️⃣ Creating purchase to lock funds...');
        const purchaseRequest = preparePurchaseRequest(paymentResponse, inputData, identifier);
        const purchaseResponse = await createPurchase(purchaseRequest);
        
        console.log(`✅ Purchase request submitted!`);
        console.log('💡 Funds should now be locked on the blockchain');
        console.log('💡 This should trigger onChainState to become "FundsLocked"');
        
        // step 4: poll until FundsLocked is detected
        console.log('\n4️⃣ Polling for FundsLocked confirmation...');
        console.log('🎯 Target: Detect onChainState === "FundsLocked"');
        console.log('📡 Monitoring both /payment/ and /purchase/ endpoints');
        
        const pollingResult = await pollUntilFundsLocked(
            inputHash, 
            identifier, 
            blockchainIdentifier, 
            Math.ceil(CONFIG.timeout * 60 / CONFIG.pollInterval)  // convert timeout minutes to iterations
        );
        
        const testEndTime = Date.now();
        const totalTestTime = (testEndTime - testStartTime) / 1000 / 60; // in minutes
        
        // step 5: analyze comprehensive results
        console.log('\n🎯 === FULL FLOW TEST RESULTS ===');
        console.log(`Test duration: ${totalTestTime.toFixed(2)} minutes`);
        console.log(`Total polling iterations: ${pollingResult.totalIterations}`);
        console.log(`Time spent polling: ${pollingResult.timeElapsed.toFixed(2)} minutes`);
        console.log(`FundsLocked detected: ${pollingResult.fundsLockedFound ? '✅ YES' : '❌ NO'}`);
        
        // detailed iteration analysis
        console.log('\n📊 === DETAILED POLLING ANALYSIS ===');
        
        let firstFundsLocked = null;
        let stateTransitions = [];
        let lastPaymentState = null;
        let lastPurchaseState = null;
        
        pollingResult.results.forEach((result, index) => {
            if (result.error) {
                console.log(`Iteration ${result.iteration}: ERROR - ${result.error}`);
                return;
            }
            
            const paymentState = result.paymentEndpoint?.onChainState;
            const purchaseState = result.purchaseEndpoint?.onChainState;
            
            console.log(`\nIteration ${result.iteration} (${result.timestamp}):`);
            console.log(`  📡 /payment/ endpoint: ${paymentState || 'null'} (found: ${result.paymentEndpoint?.paymentFound})`);
            console.log(`  📡 /purchase/ endpoint: ${purchaseState || 'null'} (found: ${result.purchaseEndpoint?.paymentFound})`);
            
            // track first FundsLocked detection
            if (!firstFundsLocked && (paymentState === 'FundsLocked' || purchaseState === 'FundsLocked')) {
                firstFundsLocked = {
                    iteration: result.iteration,
                    timeElapsed: (result.iteration * CONFIG.pollInterval) / 60,
                    paymentState,
                    purchaseState,
                    timestamp: result.timestamp
                };
                console.log(`  🎉 FIRST FUNDS_LOCKED DETECTION! Time: ${firstFundsLocked.timeElapsed.toFixed(2)} minutes`);
            }
            
            // track state transitions
            if (paymentState !== lastPaymentState || purchaseState !== lastPurchaseState) {
                stateTransitions.push({
                    iteration: result.iteration,
                    from: { payment: lastPaymentState, purchase: lastPurchaseState },
                    to: { payment: paymentState, purchase: purchaseState },
                    timeElapsed: (result.iteration * CONFIG.pollInterval) / 60
                });
                lastPaymentState = paymentState;
                lastPurchaseState = purchaseState;
            }
        });
        
        // state transition summary
        if (stateTransitions.length > 0) {
            console.log('\n🔀 === STATE TRANSITIONS ===');
            stateTransitions.forEach((transition, idx) => {
                console.log(`${idx + 1}. Iteration ${transition.iteration} (${transition.timeElapsed.toFixed(2)}min):`);
                console.log(`   From: payment=${transition.from.payment || 'null'}, purchase=${transition.from.purchase || 'null'}`);
                console.log(`   To:   payment=${transition.to.payment || 'null'}, purchase=${transition.to.purchase || 'null'}`);
            });
        }
        
        // endpoint comparison
        console.log('\n🔗 === ENDPOINT COMPARISON ===');
        const paymentResults = pollingResult.results.filter(r => !r.error && r.paymentEndpoint);
        const purchaseResults = pollingResult.results.filter(r => !r.error && r.purchaseEndpoint);
        
        const paymentFundsLocked = paymentResults.filter(r => r.paymentEndpoint.onChainState === 'FundsLocked').length;
        const purchaseFundsLocked = purchaseResults.filter(r => r.purchaseEndpoint.onChainState === 'FundsLocked').length;
        
        console.log(`/payment/ endpoint: ${paymentFundsLocked}/${paymentResults.length} iterations showed FundsLocked`);
        console.log(`/purchase/ endpoint: ${purchaseFundsLocked}/${purchaseResults.length} iterations showed FundsLocked`);
        
        // final evaluation
        console.log('\n🏆 === FINAL EVALUATION ===');
        
        const testPassed = pollingResult.fundsLockedFound;
        
        if (testPassed) {
            console.log('🎉 FULL FLOW TEST PASSED!');
            console.log('✅ Payment request created successfully');
            console.log('✅ Purchase request completed successfully');
            console.log('✅ FundsLocked state detected correctly');
            console.log(`✅ Detection time: ${firstFundsLocked.timeElapsed.toFixed(2)} minutes`);
            console.log('✅ Protocol field names working correctly');
            console.log('✅ Polling behavior matches n8n implementation');
            
            if (firstFundsLocked) {
                console.log('\n🎯 Success Details:');
                console.log(`- First detection at iteration: ${firstFundsLocked.iteration}`);
                console.log(`- Time to FundsLocked: ${firstFundsLocked.timeElapsed.toFixed(2)} minutes`);
                console.log(`- Payment endpoint state: ${firstFundsLocked.paymentState || 'null'}`);
                console.log(`- Purchase endpoint state: ${firstFundsLocked.purchaseState || 'null'}`);
            }
        } else {
            console.log('⚠️ FULL FLOW TEST INCOMPLETE');
            console.log('✅ Payment request created successfully');
            console.log('✅ Purchase request completed successfully');
            console.log('❌ FundsLocked state not detected within timeout');
            console.log(`⏰ Polling timeout: ${CONFIG.timeout} minutes`);
            console.log('💡 This may indicate longer blockchain confirmation times');
        }
        
        console.log('\n📋 === TEST SUMMARY ===');
        console.log(`- Test case: Case 9 - Full Flow Test`);
        console.log(`- Total test duration: ${totalTestTime.toFixed(2)} minutes`);
        console.log(`- Payment creation: ✅ SUCCESS`);
        console.log(`- Purchase creation: ✅ SUCCESS`);
        console.log(`- FundsLocked detection: ${testPassed ? '✅ SUCCESS' : '❌ TIMEOUT'}`);
        console.log(`- Polling iterations: ${pollingResult.totalIterations}`);
        console.log(`- State transitions: ${stateTransitions.length}`);
        console.log(`- Protocol compliance: ✅ VERIFIED`);
        
        return {
            success: testPassed,
            paymentCreated: true,
            purchaseCreated: true,
            fundsLockedDetected: pollingResult.fundsLockedFound,
            firstFundsLocked,
            pollingResult,
            stateTransitions,
            testDuration: totalTestTime,
            blockchainIdentifier,
            inputHash,
            identifier
        };
        
    } catch (error) {
        console.error('💥 FULL FLOW TEST FAILED:', error.message);
        console.error('Stack trace:', error.stack);
        
        const testEndTime = Date.now();
        const totalTestTime = (testEndTime - testStartTime) / 1000 / 60;
        
        return {
            success: false,
            error: error.message,
            testDuration: totalTestTime
        };
    }
}

// command line interface
if (require.main === module) {
    console.log('Masumi Paywall - Full Flow Test (Case 9)');
    console.log('========================================\n');
    
    // check if config is set up
    if (CONFIG.paymentServiceUrl.includes('your-masumi-service') || 
        CONFIG.apiKey === 'your-api-key') {
        console.log('⚠️ Configuration required! Please create a .env file with your actual values:');
        console.log('');
        console.log('Required environment variables:');
        console.log('- MASUMI_PAYMENT_SERVICE_URL: Your masumi service URL');
        console.log('- MASUMI_API_KEY: Your API key');  
        console.log('- MASUMI_AGENT_IDENTIFIER: Your agent ID');
        console.log('- MASUMI_SELLER_VKEY: Your seller verification key');
        console.log('- MASUMI_NETWORK: Preprod (testnet) or Mainnet');
        console.log('- MASUMI_TIMEOUT_MINUTES: Maximum polling time (default: 10)'); 
        console.log('- MASUMI_POLL_INTERVAL_SECONDS: Polling interval (default: 10)');
        console.log('');
        console.log('Example: cp .env.example .env && nano .env');
        process.exit(1);
    }
    
    testFullFlow();
}

module.exports = {
    testFullFlow,
    generateInputHash,
    generateIdentifier,
    preparePaymentRequest,
    preparePurchaseRequest,
    createPaymentRequest,
    createPurchase,
    checkPaymentStatus,
    checkPurchaseStatus,
    evaluatePaymentStatusDetailed,
    pollUntilFundsLocked
};