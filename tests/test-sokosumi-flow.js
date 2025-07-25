#!/usr/bin/env node

/**
 * Sokosumi Flow Test - Case 8
 * 
 * Tests the expected behavior when a payment is created but no actual purchase is made.
 * This simulates the "sokosumi" flow where only payment request is created without
 * locking funds. The test expects onChainState to remain null or 'pending'.
 * 
 * Expected behavior:
 * 1. Payment request creation should succeed
 * 2. Polling should continue showing null/pending state (no FundsLocked)
 * 3. This demonstrates the paywall creates the payment window but waits for actual payment
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
    pollInterval: 10 // 10 seconds for detailed monitoring
};

// core payment functions (ported from TypeScript)
function generateInputHash(inputData) {
    const inputString = inputData.input_string || 'sokosumi test data';
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
        metadata: `Sokosumi test - payment only, no purchase: ${JSON.stringify(inputData).substring(0, 100)}`,
        paymentType: 'Web3CardanoV1',
        submitResultTime: submitResultTime.toISOString(),
        identifierFromPurchaser: identifier,
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
    console.log('📤 Creating payment request (sokosumi flow)...');
    
    const response = await httpRequest({
        method: 'POST',
        url: `${CONFIG.paymentServiceUrl}/payment/`,
        headers: {
            'Content-Type': 'application/json',
            'token': CONFIG.apiKey,
            'accept': 'application/json',
        }
    }, JSON.stringify(paymentRequest));
    
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

function evaluatePaymentStatusDetailed(statusResponse, blockchainIdentifier, iteration) {
    // find our payment in the response
    let ourPayment = null;
    if (statusResponse.data && statusResponse.data.Payments) {
        ourPayment = statusResponse.data.Payments.find(
            payment => payment.blockchainIdentifier === blockchainIdentifier
        );
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
            inputHash: ourPayment.inputHash
        };
    }

    const result = {
        iteration,
        paymentFound,
        onChainState,
        blockchainIdentifier: blockchainId,
        paymentDetails,
        rawResponse: statusResponse
    };

    return result;
}

async function pollPaymentStatusDetailed(inputHash, identifier, blockchainIdentifier, maxIterations = 5) {
    console.log(`🔄 Polling ${maxIterations} iterations (expecting onChainState: null)`);
    
    const results = [];
    
    // initial delay before first check
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    for (let i = 1; i <= maxIterations; i++) {
        try {
            const statusResponse = await checkPaymentStatus(inputHash, identifier);
            const evaluation = evaluatePaymentStatusDetailed(statusResponse, blockchainIdentifier, i);
            results.push(evaluation);
            
            // Show one concise line per iteration
            const state = evaluation.onChainState || 'null';
            console.log(`🔄 [${i}/${maxIterations}] onChainState: ${state}`);
            
            // Special handling for unexpected states
            if (evaluation.onChainState === 'FundsLocked') {
                console.log(`🚨 Unexpected FundsLocked detected!`);
            }
            
            // wait before next iteration (except for last iteration)
            if (i < maxIterations) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.pollInterval * 1000));
            }
            
        } catch (error) {
            console.log(`🔄 [${i}/${maxIterations}] ERROR: ${error.message}`);
            results.push({
                iteration: i,
                error: error.message,
                paymentFound: false,
                onChainState: null
            });
        }
    }
    
    return results;
}

// main sokosumi test function
async function testSokosumiFlow() {
    console.log('🏯 Starting Sokosumi Flow Test (Case 8)');
    console.log('=====================================');
    console.log('This test creates a payment request WITHOUT making a purchase.');
    console.log('Expected: onChainState should remain null/pending (no FundsLocked)');
    console.log('Configuration:', JSON.stringify(CONFIG, null, 2));
    console.log('=' * 60);
    
    try {
        // test input data
        const inputData = { input_string: 'sokosumi flow test - payment only, no purchase' };
        
        // Generate hash and identifier
        const inputHash = generateInputHash(inputData);
        const identifier = generateIdentifier();
        console.log(`📝 Input Hash: ${inputHash}`);
        console.log(`🆔 Identifier: ${identifier}`);
        
        // Create payment request only (no purchase)
        const paymentRequest = preparePaymentRequest(inputData, inputHash, identifier);
        const paymentResponse = await createPaymentRequest(paymentRequest);
        
        if (!paymentResponse.data) {
            throw new Error('Invalid payment response: ' + JSON.stringify(paymentResponse));
        }
        
        const blockchainIdentifier = paymentResponse.data.blockchainIdentifier;
        console.log(`✅ Payment created: ${blockchainIdentifier.substring(0, 32)}...`);
        console.log(`⏭️ Skipping purchase (sokosumi flow)`);
        console.log(`🔄 Polling status (expecting onChainState: null)...`);
        const pollingResults = await pollPaymentStatusDetailed(inputHash, identifier, blockchainIdentifier, 5);
        
        // Analyze results
        let allNullStates = true;
        let fundsLockedCount = 0;
        
        pollingResults.forEach((result) => {
            if (result.onChainState !== null && result.onChainState !== undefined) {
                allNullStates = false;
                if (result.onChainState === 'FundsLocked') {
                    fundsLockedCount++;
                }
            }
        });
        
        // Final evaluation
        console.log('\n🎯 RESULT:');
        if (allNullStates) {
            console.log('✅ SOKOSUMI FLOW TEST PASSED!');
            console.log('   All onChainState values were null (expected behavior)');
        } else {
            console.log('⚠️ MIXED RESULTS');
            if (fundsLockedCount > 0) {
                console.log(`🚨 FundsLocked detected ${fundsLockedCount} times (unexpected!)`);
            }
        }
        
        return {
            success: true,
            paymentCreated: true,
            purchaseSkipped: true,
            pollingResults,
            allNullStates,
            fundsLockedCount
        };
        
    } catch (error) {
        console.error('💥 SOKOSUMI FLOW TEST FAILED:', error.message);
        console.error('Stack trace:', error.stack);
        return {
            success: false,
            error: error.message
        };
    }
}

// command line interface
if (require.main === module) {
    console.log('Masumi Paywall - Sokosumi Flow Test (Case 8)');
    console.log('============================================\n');
    
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
        console.log('');
        console.log('Example: cp .env.example .env && nano .env');
        process.exit(1);
    }
    
    testSokosumiFlow();
}

module.exports = {
    testSokosumiFlow,
    generateInputHash,
    generateIdentifier,
    preparePaymentRequest,
    createPaymentRequest,
    checkPaymentStatus,
    evaluatePaymentStatusDetailed,
    pollPaymentStatusDetailed
};