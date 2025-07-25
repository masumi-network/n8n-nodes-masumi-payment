# Masumi Paywall n8n Node - Test Suite

Comprehensive test suite for validating the masumi paywall n8n community node functionality.

## Prerequisites

1. **Environment Configuration**: Create `.env` file in project root with required credentials:
   ```bash
   MASUMI_PAYMENT_SERVICE_URL=https://masumi-payment-service.up.railway.app/api/v1
   MASUMI_API_KEY=your-api-key
   MASUMI_AGENT_IDENTIFIER=your-agent-id
   MASUMI_SELLER_VKEY=your-seller-vkey
   MASUMI_NETWORK=Preprod
   MASUMI_TIMEOUT_MINUTES=2
   MASUMI_POLL_INTERVAL_SECONDS=5
   ```

2. **Dependencies**: All tests use Node.js built-in modules (no npm install required)

## Test Files

### Core Test Suite

1. **`test-input-validation.js`** - Input validation tests (Cases 1-6)
   - Tests missing required inputs with exact error messages
   - Validates all 6 required parameters
   ```bash
   node tests/test-input-validation.js
   ```

2. **`test-authentication.js`** - Authentication test (Case 7)  
   - Tests wrong API key rejection
   - Makes real HTTP requests to masumi service
   ```bash
   node tests/test-authentication.js
   ```

3. **`test-sokosumi-flow.js`** - Sokosumi flow test (Case 8)
   - Creates payment without purchase (sokosumi marketplace flow)
   - Verifies `onChainState` remains null for 5 iterations
   ```bash
   node tests/test-sokosumi-flow.js
   ```

4. **`test-full-flow.js`** - Full payment flow test (Case 9)
   - Creates payment and purchase (complete blockchain flow)
   - Polls until `FundsLocked` detected (matches n8n behavior)
   ```bash
   node tests/test-full-flow.js
   ```

### Development Test Files

5. **`test-dual-mode.js`** - Dual-mode operation test  
   - Tests both `createPaymentOnly` and `fullFlow` modes
   - Includes summary output for all test scenarios
   ```bash
   node tests/test-dual-mode.js
   ```

6. **`test-standalone.js`** - Standalone payment logic test
   - Tests core payment functions without n8n dependencies  
   - Legacy test file for development
   ```bash
   node tests/test-standalone.js
   ```

## Test Results

All tests use **exact protocol field names** and **real API calls** to the masumi service:

- ✅ **Cases 1-6**: Input validation → All required inputs properly validated
- ✅ **Case 7**: Wrong API key → Authentication error detected  
- ✅ **Case 8**: Sokosumi flow → Payment created, `onChainState: null` (expected)
- ✅ **Case 9**: Full flow → Payment + purchase created, polling detects real blockchain states

## Running All Tests

```bash
# Run core test suite
node tests/test-input-validation.js
node tests/test-authentication.js  
node tests/test-sokosumi-flow.js
node tests/test-full-flow.js

# Run development tests  
node tests/test-dual-mode.js
node tests/test-standalone.js
```

## Key Features

- **No Hardcoded Credentials**: All tests use environment variables from `.env`
- **Real API Validation**: Tests make actual HTTP requests to masumi service
- **Protocol Compliance**: Uses exact field names (`blockchainIdentifier`, `onChainState`, etc.)
- **Clear Success/Failure**: Based on actual behavior, not artificial flags
- **n8n Alignment**: Test logic matches exactly what the n8n node does

## Troubleshooting

- **Missing credentials error**: Check your `.env` file has all required variables
- **Connection errors**: Verify `MASUMI_PAYMENT_SERVICE_URL` is correct and accessible
- **Timeout in full flow**: Normal for blockchain transactions - increase `MASUMI_TIMEOUT_MINUTES`