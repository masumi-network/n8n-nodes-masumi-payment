# Testing Guide

This project includes comprehensive unit tests and integration tests for the Masumi Payment functions.

## Test Types

### 1. Unit Tests (Default)
- **Location**: `nodes/MasumiPaywall/*.test.ts`
- **Purpose**: Test individual functions with mocked HTTP calls
- **Coverage**: Hash generation, payment creation, purchase creation, status checking
- **Run with**: `npm test`

**Features tested:**
- ✅ SHA256 hash generation consistency 
- ✅ 14-character hex identifier generation
- ✅ HTTP request construction (headers, body, URL)
- ✅ Response parsing and error handling
- ✅ Blockchain state interpretation logic
- ✅ Polling behavior and timeouts

### 2. Integration Tests (Optional)
- **Location**: `nodes/MasumiPaywall/integration.test.ts`
- **Purpose**: Test real API communication with Masumi service
- **Run with**: `RUN_INTEGRATION_TESTS=true npm run test:integration`

**Features tested:**
- ✅ Real payment creation with live API
- ✅ Real status checking with live API  
- ✅ Error handling with invalid credentials
- ✅ Full payment flow (requires ADA, skipped by default)

### 3. Manual Integration Test
- **Location**: `test-integration-manual.js`
- **Purpose**: Quick validation of API connectivity
- **Run with**: `npm run test:manual`

## Running Tests

### Quick Unit Tests (Recommended)
```bash
npm test
```
**Output**: 26 passed tests, runs in ~0.5 seconds

### Manual API Validation
```bash
npm run test:manual
```
**Requirements**: Valid `.env` configuration
**Output**: Creates real payment, checks status, validates API connectivity

### Full Integration Tests (Advanced)
```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```
**Requirements**: Valid `.env` configuration, potential ADA costs for full flow
**Warning**: The full payment flow test is skipped by default to avoid blockchain costs

## Environment Setup

Create `.env` file with:
```env
MASUMI_PAYMENT_SERVICE_URL=https://your-service.com/api/v1
MASUMI_API_KEY=your_api_key_here
MASUMI_AGENT_IDENTIFIER=your_agent_identifier
MASUMI_SELLER_VKEY=your_seller_vkey
MASUMI_NETWORK=Preprod
```

## Test Philosophy

### Unit Tests: Mock Everything External
- Mock `fetch()` calls to avoid API dependencies
- Test actual request construction and response parsing
- Verify business logic and error handling
- Fast execution, no external dependencies

### Integration Tests: Real API, Controlled Costs
- Use real API calls for payment creation and status checking
- Skip expensive blockchain operations by default
- Validate API compatibility and network connectivity
- Optional execution to avoid unnecessary costs

### Manual Tests: Developer Validation
- Quick sanity check for API connectivity
- Validates environment configuration
- Provides immediate feedback on API changes
- Safe, low-cost operations only

## Test Coverage

| Function | Unit Tests | Integration Tests | Manual Test |
|----------|------------|-------------------|-------------|
| `generateInputHash()` | ✅ | ❌ | ❌ |
| `generateIdentifier()` | ✅ | ❌ | ❌ |
| `preparePaymentData()` | ✅ | ✅ | ✅ |
| `createPayment()` | ✅ | ✅ | ✅ |
| `createPurchase()` | ✅ | ✅ (skip) | ❌ |
| `checkPaymentStatus()` | ✅ | ✅ | ✅ |
| `pollPaymentStatus()` | ✅ | ✅ (partial) | ❌ |
| `interpretPaymentStatus()` | ✅ | ❌ | ❌ |

## CI/CD Integration

The `npm run prepublishOnly` script runs:
1. `npm run build` - Compile TypeScript
2. `npm run lint -q` - Check code quality  
3. `npm run format` - Format code
4. `npm run test` - Run unit tests (not integration)

This ensures only unit tests run during packaging/publishing to avoid:
- External API dependencies in CI
- Potential blockchain costs
- Network-related test failures

## Debugging Test Failures

### Unit Test Failures
- Check mock expectations match actual function calls
- Verify request body structure (camelCase vs snake_case)
- Ensure headers match implementation (`token` not `x-api-key`)

### Integration Test Failures  
- Verify `.env` configuration is correct
- Check API service availability
- Validate network connectivity
- Confirm API key permissions

### Manual Test Failures
- Same as integration test debugging
- Check console output for specific error messages
- Verify Masumi service is operational